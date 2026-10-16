/* ============================================================
   VuxPet — pro.js
   Área do profissional: acesso próprio (login/cadastro) e painel
   com métricas, agenda do dia, fila de atendimentos e tutores.
   No Supabase usa a tabela `professionals` (id = auth.users.id).
   ============================================================ */

const Pro = (() => {
    'use strict';

    const $  = (sel, ctx = document) => ctx.querySelector(sel);
    const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));

    const SESSION_KEY = 'vuxpet:proSession';
    const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

    const PENDING = ['Agendada', 'Confirmada'];
    const FINISHED = ['Concluída', 'Cancelada'];

    /** Sessão em memória: { id, name, email, crmv, clinic } */
    let session = null;
    let currentFilter = 'all';
    let claimRunning = false;

    const hasSupabase = () => DB.isConfigured;
    const client = () => DB.client;

    /* ---------- Sessão ---------- */
    function getSession() {
        return session;
    }

    function clearSession() {
        session = null;
        DB.storage.local.removeRaw(SESSION_KEY);
        DB.storage.session.removeRaw(SESSION_KEY);
        if (DB.keys) DB.setLocalClinic(null);
        updateProUI();
    }

    function writeSession(value) {
        DB.storage.local.setRaw(SESSION_KEY, JSON.stringify(value));
        DB.storage.session.removeRaw(SESSION_KEY);
    }

    function readStoredSession() {
        try {
            const raw =
                DB.storage.session.getRaw(SESSION_KEY) ||
                DB.storage.local.getRaw(SESSION_KEY);
            return raw ? JSON.parse(raw) : null;
        } catch {
            return null;
        }
    }

    function setSession(value) {
        session = value;
        if (session) {
            writeSession(session);
            DB.setLocalClinic(session.clinic);
            if (window.Auth) Auth.clearSession();
        }
        updateProUI();
    }

    /* ---------- UI básica ---------- */
    function setFieldError(fieldId, hasError) {
        const field = document.getElementById(fieldId);
        if (field) field.classList.toggle('has-error', hasError);
    }

    function clearErrors(form) {
        form.querySelectorAll('.field').forEach(f => f.classList.remove('has-error'));
        const terms = form.querySelector('.terms-error');
        if (terms) terms.classList.remove('show');
    }

    function setBusy(button, busy, label) {
        if (busy) {
            button.dataset.original = button.innerHTML;
            button.disabled = true;
            button.innerHTML = `<span class="loading"></span> ${label}`;
        } else {
            button.disabled = false;
            if (button.dataset.original) button.innerHTML = button.dataset.original;
        }
    }

    function updateProUI() {
        const authView = $('#proAuth');
        const panel = $('#proPanel');
        if (!authView || !panel) return;

        if (session) {
            authView.classList.add('hidden');
            panel.classList.remove('hidden');
            $('#proName').textContent = session.name;
            $('#proClinicName').textContent = session.clinic;
        } else {
            authView.classList.remove('hidden');
            panel.classList.add('hidden');
        }
    }

    function setProTab(tab) {
        const isLogin = tab !== 'register';

        $('#proTabLogin').classList.toggle('active', isLogin);
        $('#proTabRegister').classList.toggle('active', !isLogin);
        $('#proTabLogin').setAttribute('aria-selected', String(isLogin));
        $('#proTabRegister').setAttribute('aria-selected', String(!isLogin));

        $('#proLoginPanel').classList.toggle('active', isLogin);
        $('#proRegisterPanel').classList.toggle('active', !isLogin);

        $('#proAuthTitle').textContent = isLogin ? 'Acesso do profissional' : 'Criar acesso profissional';
        $('#proAuthSubtitle').textContent = isLogin
            ? 'Entre para ver os agendamentos da sua clínica.'
            : 'Cadastre seu registro e a clínica que você atende.';

        clearErrors($('#proLoginPanel'));
        clearErrors($('#proRegisterPanel'));
    }

    function friendlyError(error) {
        const msg = (error && error.message) || '';
        if (/already registered|already exists|user_already_exists/i.test(msg)) {
            return 'Este e-mail já possui uma conta.';
        }
        if (/invalid login credentials/i.test(msg)) {
            return 'E-mail ou senha incorretos.';
        }
        if (/email not confirmed/i.test(msg)) {
            return 'Confirme seu e-mail antes de entrar.';
        }
        if (/fetch|network|Failed to fetch/i.test(msg)) {
            return 'Falha de conexão com o servidor.';
        }
        return msg || 'Não foi possível concluir a operação.';
    }

    /* ---------- Validação ---------- */
    function validateLogin() {
        let valid = true;
        const emailOk = EMAIL_REGEX.test($('#proLoginEmail').value.trim());
        setFieldError('proLoginEmailField', !emailOk);
        if (!emailOk) valid = false;

        const passOk = $('#proLoginPassword').value.length > 0;
        setFieldError('proLoginPasswordField', !passOk);
        if (!passOk) valid = false;
        return valid;
    }

    function validateRegister() {
        let valid = true;

        const name = $('#proRegName').value.trim();
        const nameOk = name.length >= 3 && name.includes(' ');
        setFieldError('proRegNameField', !nameOk);
        if (!nameOk) valid = false;

        const crmv = $('#proRegCrmv').value.trim();
        const crmvOk = crmv.length >= 4;
        setFieldError('proRegCrmvField', !crmvOk);
        if (!crmvOk) valid = false;

        const clinic = $('#proRegClinic').value;
        setFieldError('proRegClinicField', !clinic);
        if (!clinic) valid = false;

        const emailOk = EMAIL_REGEX.test($('#proRegEmail').value.trim().toLowerCase());
        setFieldError('proRegEmailField', !emailOk);
        if (!emailOk) valid = false;

        const password = $('#proRegPassword').value;
        const passOk = password.length >= 8 && /[a-zA-Z]/.test(password) && /\d/.test(password);
        setFieldError('proRegPasswordField', !passOk);
        if (!passOk) valid = false;

        const confirm = $('#proRegConfirm').value;
        const confirmOk = confirm.length > 0 && confirm === password;
        setFieldError('proRegConfirmField', !confirmOk);
        if (!confirmOk) valid = false;

        const termsOk = $('#proRegTerms').checked;
        $('#proTermsError').classList.toggle('show', !termsOk);
        if (!termsOk) valid = false;

        return valid;
    }

    /* ---------- Supabase ---------- */
    async function findProfessional(userId) {
        const { data, error } = await client()
            .from('professionals')
            .select('full_name, crmv, clinic')
            .eq('id', userId)
            .maybeSingle();
        if (error) throw error;
        return data || null;
    }

    /* ---------- Login ---------- */
    async function login(e) {
        e.preventDefault();
        const form = $('#proLoginPanel');
        clearErrors(form);

        if (!validateLogin()) {
            App.toast('Corrija os campos destacados.', 'error');
            return;
        }

        const email = $('#proLoginEmail').value.trim().toLowerCase();
        const password = $('#proLoginPassword').value;
        const button = $('#proLoginSubmit');
        setBusy(button, true, 'Entrando...');

        try {
            if (hasSupabase()) {
                const { data, error } = await client().auth.signInWithPassword({ email, password });
                if (error) {
                    if (/invalid login credentials/i.test(error.message || '')) {
                        setFieldError('proLoginPasswordField', true);
                    }
                    throw error;
                }

                const pro = await findProfessional(data.user.id);
                if (!pro) {
                    if (window.Auth) await Auth.restoreSupabaseSession();
                    App.toast('Este e-mail é de cliente. Use a entrada do cliente.', 'warning');
                    App.showPage('auth');
                    if (window.Auth) Auth.setAuthTab('login');
                    $('#loginEmail').value = email;
                    return;
                }

                setSession({
                    id: data.user.id,
                    name: pro.full_name,
                    email,
                    crmv: pro.crmv || '',
                    clinic: pro.clinic
                });
                App.toast(`Bem-vindo(a), ${pro.full_name.split(' ')[0]}!`, 'success');
                await renderPanel();
                return;
            }

            // ---- modo local ----
            const pro = DB.storage.get(DB.keys.pros, []).find(p => p.email === email);
            if (!pro || pro.password !== localHash(password)) {
                setFieldError('proLoginPasswordField', true);
                App.toast('E-mail ou senha incorretos.', 'error');
                return;
            }

            await delay(400);
            setSession({ id: pro.id, name: pro.name, email: pro.email, crmv: pro.crmv, clinic: pro.clinic });
            form.reset();
            App.toast(`Bem-vindo(a), ${pro.name.split(' ')[0]}!`, 'success');
            await renderPanel();
        } catch (err) {
            App.toast(friendlyError(err), 'error');
        } finally {
            setBusy(button, false);
        }
    }

    /* ---------- Cadastro ---------- */
    async function register(e) {
        e.preventDefault();
        const form = $('#proRegisterPanel');
        clearErrors(form);

        if (!validateRegister()) {
            App.toast('Corrija os campos destacados.', 'error');
            return;
        }

        const name = $('#proRegName').value.trim();
        const crmv = $('#proRegCrmv').value.trim();
        const clinic = $('#proRegClinic').value;
        const email = $('#proRegEmail').value.trim().toLowerCase();
        const password = $('#proRegPassword').value;

        const button = $('#proRegisterSubmit');
        setBusy(button, true, 'Criando acesso...');

        try {
            if (hasSupabase()) {
                const { data, error } = await client().auth.signUp({
                    email,
                    password,
                    options: {
                        data: { full_name: name, crmv, clinic, role: 'professional' }
                    }
                });

                if (error) {
                    if (/already registered/i.test(error.message || '')) {
                        setFieldError('proRegEmailField', true);
                    }
                    throw error;
                }

                if (!data.session) {
                    resetRegisterForm(form);
                    setProTab('login');
                    $('#proLoginEmail').value = email;
                    App.toast('Conta criada! Confirme seu e-mail para entrar.', 'success');
                    return;
                }

                const pro = await findProfessional(data.user.id);
                setSession({
                    id: data.user.id,
                    name,
                    email,
                    crmv,
                    clinic: (pro && pro.clinic) || clinic
                });
                resetRegisterForm(form);
                App.toast(`Acesso criado. Bem-vindo(a), ${name.split(' ')[0]}!`, 'success');
                await renderPanel();
                return;
            }

            // ---- modo local ----
            const pros = DB.storage.get(DB.keys.pros, []);
            if (pros.some(p => p.email === email)) {
                setFieldError('proRegEmailField', true);
                App.toast('Este e-mail já possui acesso profissional.', 'error');
                return;
            }

            await delay(400);

            const pro = {
                id: `pro-${Date.now()}`,
                name,
                crmv,
                clinic,
                email,
                password: localHash(password),
                createdAt: new Date().toISOString()
            };
            pros.push(pro);
            DB.storage.set(DB.keys.pros, pros);

            setSession({ id: pro.id, name, email, crmv, clinic });
            resetRegisterForm(form);
            App.toast(`Acesso criado. Bem-vindo(a), ${name.split(' ')[0]}!`, 'success');
            await renderPanel();
        } catch (err) {
            App.toast(friendlyError(err), 'error');
        } finally {
            setBusy(button, false);
        }
    }

    function resetRegisterForm(form) {
        form.reset();
        $('#proTermsError').classList.remove('show');
    }

    /* ---------- Sair ---------- */
    async function logout() {
        if (hasSupabase()) {
            try {
                await client().auth.signOut();
            } catch (err) {
                console.error('[VuxPet] signOut (pro):', err);
            }
        }
        currentFilter = 'all';
        clearSession();
        App.toast('Você saiu da área do profissional.', 'warning');
        App.showPage('home');
    }

    /* ---------- Painel ---------- */
    async function renderPanel() {
        updateProUI();
        if (!session) return;

        $('#proName').textContent = session.name;
        $('#proClinicName').textContent = session.clinic;

        const queue = $('#proQueue');
        queue.innerHTML = `<div class="empty-state"><span class="loading" style="margin:0 auto 8px;"></span><div>Carregando agendamentos...</div></div>`;

        try {
            const appts = await DB.appointments.list();
            renderMetrics(appts);
            renderToday(appts);
            renderTutors(appts);
            renderQueue(appts);
        } catch (err) {
            console.error('[VuxPet]', err && err.detail ? err.detail : err);
            queue.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-triangle-exclamation"></i>
                    ${App.escapeHtml(err.message || 'Erro ao carregar agendamentos.')}
                </div>`;
            App.toast(err.message || 'Erro ao carregar agendamentos.', 'error');
        }
    }

    function renderMetrics(appts) {
        const today = App.todayISO();
        const weekEnd = new Date();
        weekEnd.setDate(weekEnd.getDate() + 6);
        const weekEndISO = toISO(weekEnd);

        const stats = [
            {
                label: 'Hoje',
                value: appts.filter(a => a.date === today).length,
                icon: 'fa-calendar-day',
                tone: 'primary'
            },
            {
                label: 'Próximos 7 dias',
                value: appts.filter(a => a.date >= today && a.date <= weekEndISO && !FINISHED.includes(a.status)).length,
                icon: 'fa-calendar-week',
                tone: 'info'
            },
            {
                label: 'Pendentes',
                value: appts.filter(a => PENDING.includes(a.status)).length,
                icon: 'fa-hourglass-half',
                tone: 'warning'
            },
            {
                label: 'Concluídos',
                value: appts.filter(a => a.status === 'Concluída').length,
                icon: 'fa-circle-check',
                tone: 'success'
            }
        ];

        $('#proMetrics').innerHTML = stats.map(s => `
            <div class="metric-card">
                <div class="metric-icon tone-${s.tone}"><i class="fas ${s.icon}"></i></div>
                <div class="metric-value">${s.value}</div>
                <div class="metric-label">${s.label}</div>
            </div>
        `).join('');
    }

    function renderToday(appts) {
        const today = App.todayISO();
        const list = appts
            .filter(a => a.date === today && a.status !== 'Cancelada')
            .sort((a, b) => a.time.localeCompare(b.time));

        const box = $('#proToday');
        if (!list.length) {
            box.innerHTML = `<div class="empty-state"><i class="fas fa-calendar-xmark"></i>Nenhum atendimento para hoje.</div>`;
            return;
        }

        box.innerHTML = list.map(a => `
            <div class="mini-row">
                <span class="mini-time">${App.escapeHtml(a.time)}</span>
                <div class="mini-info">
                    <h4>${App.escapeHtml(a.vaccine)} · ${App.escapeHtml(a.pet)}</h4>
                    <p>${App.escapeHtml(a.tutorName)}</p>
                </div>
                <span class="badge ${App.statusBadge(a.status)}">${App.escapeHtml(a.status)}</span>
            </div>
        `).join('');
    }

    function renderTutors(appts) {
        const grouped = new Map();

        appts.forEach(a => {
            const key = a.tutorName || 'Tutor';
            if (!grouped.has(key)) grouped.set(key, { tutor: key, pets: new Map(), last: '' });
            const entry = grouped.get(key);
            const petKey = `${a.pet}`;
            if (!entry.pets.has(petKey)) {
                entry.pets.set(petKey, { name: a.pet, species: a.petSpecies || '', visits: 0 });
            }
            entry.pets.get(petKey).visits += 1;
            if (a.date > entry.last) entry.last = a.date;
        });

        const box = $('#proTutors');
        const entries = Array.from(grouped.values()).sort((a, b) => a.tutor.localeCompare(b.tutor));

        if (!entries.length) {
            box.innerHTML = `<div class="empty-state"><i class="fas fa-users"></i>Nenhum tutor atendido ainda.</div>`;
            return;
        }

        box.innerHTML = entries.map(g => `
            <div class="tutor-row">
                <div class="tutor-avatar">${App.escapeHtml(g.tutor.charAt(0))}</div>
                <div class="tutor-info">
                    <h4>${App.escapeHtml(g.tutor)}</h4>
                    <p>${Array.from(g.pets.values()).map(p =>
                        `${App.escapeHtml(p.name)}${p.species ? ' (' + App.escapeHtml(p.species) + ')' : ''}`
                    ).join(' · ')}</p>
                </div>
                <span class="badge badge-info">${g.pets.size} pet${g.pets.size > 1 ? 's' : ''}</span>
            </div>
        `).join('');
    }

    function renderQueue(appts) {
        const today = App.todayISO();

        const filtered = appts.filter(a => {
            if (currentFilter === 'today') return a.date === today;
            if (currentFilter === 'pending') return PENDING.includes(a.status);
            if (currentFilter === 'done') return a.status === 'Concluída';
            return true;
        }).sort((a, b) => (b.date + b.time).localeCompare(a.date + b.time));

        $('#proQueueCount').textContent = String(filtered.length);

        const box = $('#proQueue');
        if (!filtered.length) {
            box.innerHTML = `<div class="empty-state"><i class="fas fa-inbox"></i>Nenhum agendamento neste filtro.</div>`;
            return;
        }

        box.innerHTML = filtered.map(a => {
            const canConfirm = a.status === 'Agendada';
            const canFinish = a.status === 'Confirmada';
            const canCancel = PENDING.includes(a.status);

            return `
            <div class="queue-row" data-status="${App.escapeHtml(a.status)}">
                <div class="queue-when">
                    <strong>${App.escapeHtml(App.formatDate(a.date))}</strong>
                    <span>${App.escapeHtml(a.time)}</span>
                </div>
                <div class="queue-main">
                    <h4>${App.escapeHtml(a.vaccine)} · ${App.escapeHtml(a.pet)}</h4>
                    <p>
                        <i class="fa-regular fa-user"></i> ${App.escapeHtml(a.tutorName)}
                        ${a.petSpecies ? ' · <i class="fa-solid fa-paw"></i> ' + App.escapeHtml(a.petSpecies) : ''}
                        · <i class="fa-regular fa-building"></i> ${App.escapeHtml(a.clinic)}
                    </p>
                </div>
                <span class="badge ${App.statusBadge(a.status)}">${App.escapeHtml(a.status)}</span>
                <div class="queue-actions">
                    ${canConfirm ? actionBtn(a.id, 'Confirmada', 'Confirmar', 'btn-primary', 'fa-check') : ''}
                    ${canFinish ? actionBtn(a.id, 'Concluída', 'Concluir', 'btn-success', 'fa-flag-checkered') : ''}
                    ${canCancel ? actionBtn(a.id, 'Cancelada', 'Cancelar', 'btn-ghost', 'fa-xmark') : ''}
                    ${FINISHED.includes(a.status) ? '<span class="queue-done"><i class="fas fa-lock"></i> Finalizado</span>' : ''}
                </div>
            </div>`;
        }).join('');
    }

    function actionBtn(id, next, label, variant, icon) {
        return `
            <button type="button" class="btn btn-sm ${variant}" data-appt="${App.escapeHtml(id)}" data-next="${next}">
                <i class="fas ${icon}"></i> ${label}
            </button>`;
    }

    async function changeStatus(id, status) {
        try {
            const updated = await DB.appointments.updateStatus(id, status);
            App.toast(`Agendamento de ${updated.pet} marcado como ${status.toLowerCase()}.`);
            await renderPanel();
        } catch (err) {
            App.toast(err.message || 'Não foi possível atualizar o status.', 'error');
        }
    }

    /* ---------- Helpers ---------- */
    function toISO(date) {
        const p = n => String(n).padStart(2, '0');
        return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
    }

    function delay(ms) {
        return new Promise(r => setTimeout(r, ms));
    }

    function localHash(str) {
        let h = 5381;
        for (let i = 0; i < str.length; i++) {
            h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
        }
        return `vx$${h.toString(16)}`;
    }

    /* ---------- Init ---------- */
    function init() {
        // O painel do profissional só existe no index.html.
        if (!document.getElementById('proPanel')) return;

        $('#proTabLogin').addEventListener('click', () => setProTab('login'));
        $('#proTabRegister').addEventListener('click', () => setProTab('register'));

        $('#proLoginPanel').addEventListener('submit', login);
        $('#proRegisterPanel').addEventListener('submit', register);
        $('#proLogoutBtn').addEventListener('click', e => {
            e.preventDefault();
            logout();
        });
        $('#proRefreshBtn').addEventListener('click', e => {
            e.preventDefault();
            renderPanel();
        });

        $('#proRegTerms').addEventListener('change', () => {
            $('#proTermsError').classList.remove('show');
        });

        const fieldMap = {
            proLoginEmail: 'proLoginEmailField',
            proLoginPassword: 'proLoginPasswordField',
            proRegName: 'proRegNameField',
            proRegCrmv: 'proRegCrmvField',
            proRegClinic: 'proRegClinicField',
            proRegEmail: 'proRegEmailField',
            proRegPassword: 'proRegPasswordField',
            proRegConfirm: 'proRegConfirmField'
        };
        Object.entries(fieldMap).forEach(([inputId, fieldId]) => {
            document.getElementById(inputId).addEventListener('input', () => {
                setFieldError(fieldId, false);
            });
        });

        document.addEventListener('click', e => {
            const sw = e.target.closest('[data-pro-switch]');
            if (sw) setProTab(sw.dataset.proSwitch);

            const chip = e.target.closest('.filter-chip[data-filter]');
            if (chip) {
                currentFilter = chip.dataset.filter;
                $$('#proFilters .filter-chip').forEach(c => c.classList.toggle('active', c === chip));
                renderPanel();
                return;
            }

            const action = e.target.closest('[data-appt][data-next]');
            if (action) {
                changeStatus(action.dataset.appt, action.dataset.next);
            }
        });

        // ---- restaura sessão ----
        if (hasSupabase()) {
            claimSupabaseSession();
        } else {
            const stored = readStoredSession();
            if (stored) {
                session = stored;
                DB.setLocalClinic(stored.clinic);
                if (window.Auth) Auth.clearSession();
            }
        }

        updateProUI();
    }

    /**
     * Restaura/reclama a sessão Supabase atual como sessão de profissional.
     * Usada no boot e quando o cliente tenta entrar com e-mail de pro.
     */
    async function claimSupabaseSession() {
        if (claimRunning) return;
        claimRunning = true;
        try {
            const { data, error } = await client().auth.getSession();
            if (error) throw error;
            if (!data || !data.session) {
                updateProUI();
                return;
            }

            const pro = await findProfessional(data.session.user.id);
            if (pro) {
                session = {
                    id: data.session.user.id,
                    name: pro.full_name,
                    email: data.session.user.email,
                    crmv: pro.crmv || '',
                    clinic: pro.clinic
                };
                DB.setLocalClinic(pro.clinic);
                if (window.Auth) Auth.clearSession();
            } else if (window.Auth) {
                Auth.restoreSupabaseSession();
            }
            updateProUI();
        } catch (err) {
            console.error('[VuxPet] restore (pro):', err);
            updateProUI();
        } finally {
            claimRunning = false;
        }
    }

    return {
        init,
        getSession,
        clearSession,
        setProTab,
        renderPanel,
        claimSupabaseSession
    };
})();

window.Pro = Pro;

document.addEventListener('DOMContentLoaded', () => {
    if (window.Pro) Pro.init();
});
