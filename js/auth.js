/* ============================================================
   VuxPet — auth.js
   Autenticação via Supabase Auth (e-mail/senha, OAuth e
   recuperação de senha). Sem credenciais configuradas, usa
   o modo local (localStorage) para demonstração.
   ============================================================ */

const Auth = (() => {
    'use strict';

    const $  = (sel, ctx = document) => ctx.querySelector(sel);
    const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));

    const USERS_KEY = 'vuxpet:users';
    const SESSION_KEY = 'vuxpet:session';
    const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

    /** Sessão em memória: { id, name, email } | null */
    let session = null;

    const hasSupabase = () => DB.isConfigured;
    const client = () => DB.client;

    const delay = ms => new Promise(r => setTimeout(r, ms));

    /* ---------- Sessão ---------- */
    function getSession() {
        return session;
    }

    /** Remove a sessão do cliente (usado ao entrar como profissional). */
    function clearSession() {
        session = null;
        clearLocalSession();
        DB.setLocalOwner(null);
        updateAuthUI();
    }

    function isProfessionalMeta(user) {
        const meta = (user && user.user_metadata) || {};
        return meta.role === 'professional';
    }

    /** Consulta a tabela professionals (null se não for profissional). */
    async function findProfessional(userId) {
        if (!hasSupabase()) return null;
        try {
            const { data, error } = await client()
                .from('professionals')
                .select('id, full_name, clinic')
                .eq('id', userId)
                .maybeSingle();
            if (error) return null;
            return data || null;
        } catch {
            return null;
        }
    }

    function mapSession(snap) {
        const u = snap.user;
        const meta = u.user_metadata || {};
        return {
            id: u.id,
            email: u.email,
            name: meta.full_name || (u.email || '').split('@')[0]
        };
    }

    async function resolveName(user) {
        const meta = user.user_metadata || {};
        const fallback = meta.full_name || (user.email || '').split('@')[0];
        if (!hasSupabase()) return fallback;

        try {
            const { data, error } = await client()
                .from('profiles')
                .select('full_name')
                .eq('id', user.id)
                .maybeSingle();
            if (error) return fallback;
            return (data && data.full_name) || fallback;
        } catch {
            return fallback;
        }
    }

    function upgradeName(user) {
        resolveName(user)
            .then(name => {
                if (session && session.id === user.id && name && name !== session.name) {
                    session.name = name;
                    updateAuthUI();
                }
            })
            .catch(() => {});
    }

    /* ---------- Persistência local (fallback) ---------- */
    function readLocalSession() {
        try {
            const raw =
                DB.storage.session.getRaw(SESSION_KEY) ||
                DB.storage.local.getRaw(SESSION_KEY);
            return raw ? JSON.parse(raw) : null;
        } catch {
            return null;
        }
    }

    function writeLocalSession(user, remember = true) {
        const payload = JSON.stringify(user);
        DB.storage.session.removeRaw(SESSION_KEY);
        DB.storage.local.removeRaw(SESSION_KEY);
        if (remember) {
            DB.storage.local.setRaw(SESSION_KEY, payload);
        } else {
            DB.storage.session.setRaw(SESSION_KEY, payload);
        }
    }

    function clearLocalSession() {
        DB.storage.local.removeRaw(SESSION_KEY);
        DB.storage.session.removeRaw(SESSION_KEY);
    }

    function getUsers() {
        try {
            return JSON.parse(DB.storage.local.getRaw(USERS_KEY)) || [];
        } catch {
            return [];
        }
    }

    function saveUsers(users) {
        DB.storage.local.setRaw(USERS_KEY, JSON.stringify(users));
    }

    /* ---------- UI ---------- */
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

    function updateAuthUI() {
        const authNav = $('#authNav');
        const userNav = $('#userNav');

        if (session) {
            const firstName = session.name.split(' ')[0];
            authNav.classList.add('hidden');
            userNav.classList.remove('hidden');
            $('#userNameDisplay').textContent = firstName;
            $('#userAvatar').textContent = session.name.charAt(0);
            $('#dashboardUserName').textContent = firstName;
        } else {
            authNav.classList.remove('hidden');
            userNav.classList.add('hidden');
            $('#dashboardUserName').textContent = 'Tutor';
        }
    }

    /* ---------- Abas Entrar / Cadastrar ---------- */
    function setAuthTab(tab) {
        const isLogin = tab !== 'register';

        $('#tabLogin').classList.toggle('active', isLogin);
        $('#tabRegister').classList.toggle('active', !isLogin);
        $('#tabLogin').setAttribute('aria-selected', String(isLogin));
        $('#tabRegister').setAttribute('aria-selected', String(!isLogin));

        $('#panelLogin').classList.toggle('active', isLogin);
        $('#panelRegister').classList.toggle('active', !isLogin);

        $('#authTitle').textContent = isLogin ? 'Acesse sua conta' : 'Crie sua conta';
        $('#authSubtitle').textContent = isLogin
            ? 'Entre para gerenciar a saúde do seu pet.'
            : 'Cadastre-se grátis e comece a cuidar melhor.';

        clearErrors($('#panelLogin'));
        clearErrors($('#panelRegister'));
    }

    /* ---------- Validação ---------- */
    function validateRegister() {
        let valid = true;

        const name = $('#regName').value.trim();
        const nameOk = name.length >= 3 && name.includes(' ');
        setFieldError('regNameField', !nameOk);
        if (!nameOk) valid = false;

        const email = $('#regEmail').value.trim().toLowerCase();
        const emailOk = EMAIL_REGEX.test(email);
        setFieldError('regEmailField', !emailOk);
        if (!emailOk) valid = false;

        const password = $('#regPassword').value;
        const passOk = password.length >= 8 && /[a-zA-Z]/.test(password) && /\d/.test(password);
        setFieldError('regPasswordField', !passOk);
        if (!passOk) valid = false;

        const confirm = $('#regConfirm').value;
        const confirmOk = confirm.length > 0 && confirm === password;
        setFieldError('regConfirmField', !confirmOk);
        if (!confirmOk) valid = false;

        const termsOk = $('#regTerms').checked;
        $('#termsError').classList.toggle('show', !termsOk);
        if (!termsOk) valid = false;

        return valid;
    }

    function validateLogin() {
        let valid = true;

        const email = $('#loginEmail').value.trim();
        const emailOk = EMAIL_REGEX.test(email);
        setFieldError('loginEmailField', !emailOk);
        if (!emailOk) valid = false;

        const password = $('#loginPassword').value;
        const passOk = password.length > 0;
        setFieldError('loginPasswordField', !passOk);
        if (!passOk) valid = false;

        return valid;
    }

    function friendlyError(error) {
        const msg = (error && error.message) || '';
        const code = (error && (error.code || error.error_code)) || '';
        if (/already registered|already exists|user_already_exists/i.test(msg)) {
            return 'Este e-mail já possui uma conta.';
        }
        if (/provider is not enabled|unsupported provider/i.test(msg)) {
            return 'Login com Google ainda não está habilitado. Use e-mail e senha.';
        }
        if (/invalid login credentials/i.test(msg)) {
            return 'E-mail ou senha incorretos.';
        }
        if (/email not confirmed/i.test(msg)) {
            return 'Confirme seu e-mail antes de entrar.';
        }
        if (/password should be at least/i.test(msg)) {
            return 'A senha precisa ter no mínimo 8 caracteres.';
        }
        if (/over_email_send_rate_limit/i.test(msg + ' ' + code) ||
            /email rate limit/i.test(msg)) {
            return 'O site atingiu o limite de e-mails de confirmação. Tente novamente em alguns minutos.';
        }
        if (/over_request_rate_limit|too many requests/i.test(msg + ' ' + code)) {
            return 'Muitas tentativas. Aguarde um instante e tente novamente.';
        }
        if (/rate limit|too many/i.test(msg)) {
            return 'Muitas tentativas. Aguarde um instante e tente novamente.';
        }
        if (/fetch|network|Failed to fetch/i.test(msg)) {
            return 'Falha de conexão com o servidor.';
        }
        return msg || 'Não foi possível concluir a operação.';
    }

    /* ---------- Cadastro ---------- */
    async function register(e) {
        e.preventDefault();
        const form = $('#panelRegister');
        clearErrors(form);

        if (!validateRegister()) {
            App.toast('Corrija os campos destacados.', 'error');
            return;
        }

        const name = $('#regName').value.trim();
        const email = $('#regEmail').value.trim().toLowerCase();
        const password = $('#regPassword').value;

        const button = $('#registerSubmit');
        setBusy(button, true, 'Criando conta...');

        try {
            if (hasSupabase()) {
                const { data, error } = await client().auth.signUp({
                    email,
                    password,
                    options: { data: { full_name: name } }
                });

                if (error) {
                    if (/already registered/i.test(error.message || '')) {
                        setFieldError('regEmailField', true);
                    }
                    App.toast(friendlyError(error), 'error');
                    return;
                }

                if (!data.session) {
                    resetRegisterForm(form);
                    setAuthTab('login');
                    $('#loginEmail').value = email;
                    App.toast('Conta criada! Confirme seu e-mail para entrar.', 'success');
                    return;
                }

                session = mapSession(data.session);
                session.name = name;
                if (window.Pro) Pro.clearSession();
                resetRegisterForm(form);
                updateAuthUI();
                App.toast(`Bem-vindo(a), ${name.split(' ')[0]}!`, 'success');
                App.showPage('dashboard');
                upgradeName(data.session.user);
                return;
            }

            // ---- modo local ----
            const users = getUsers();
            if (users.some(u => u.email === email)) {
                setFieldError('regEmailField', true);
                App.toast('Este e-mail já possui uma conta.', 'error');
                return;
            }

            await delay(500);

            const user = {
                id: String(Date.now()),
                name,
                email,
                password: hash(password),
                createdAt: new Date().toISOString()
            };
            users.push(user);
            saveUsers(users);

            session = { id: user.id, name: user.name, email: user.email };
            writeLocalSession(session, true);
            DB.setLocalOwner(email);
            if (window.Pro) Pro.clearSession();

            resetRegisterForm(form);
            updateAuthUI();
            App.toast(`Bem-vindo(a), ${name.split(' ')[0]}!`, 'success');
            App.showPage('dashboard');
        } catch (err) {
            App.toast(friendlyError(err), 'error');
        } finally {
            setBusy(button, false);
        }
    }

    function resetRegisterForm(form) {
        form.reset();
        $('#passwordStrength').dataset.level = '0';
        $('#strengthLabel').textContent = 'Use letras e números.';
        $('#strengthLabel').style.color = 'var(--gray)';
    }

    /* ---------- Login ---------- */
    async function login(e) {
        e.preventDefault();
        const form = $('#panelLogin');
        clearErrors(form);

        if (!validateLogin()) {
            App.toast('Corrija os campos destacados.', 'error');
            return;
        }

        const email = $('#loginEmail').value.trim().toLowerCase();
        const password = $('#loginPassword').value;

        const button = $('#loginSubmit');
        setBusy(button, true, 'Entrando...');

        try {
            if (hasSupabase()) {
                const { data, error } = await client().auth.signInWithPassword({ email, password });

                if (error) {
                    if (/invalid login credentials/i.test(error.message || '')) {
                        setFieldError('loginPasswordField', true);
                    }
                    App.toast(friendlyError(error), 'error');
                    return;
                }

                const pro = await findProfessional(data.user.id);
                if (pro) {
                    form.reset();
                    if (window.Pro) {
                        await Pro.claimSupabaseSession();
                        App.toast(`Este é um acesso de profissional (${pro.clinic}).`, 'warning');
                        App.showPage('pro');
                    } else {
                        App.toast('Este e-mail possui acesso de profissional.', 'warning');
                    }
                    return;
                }

                session = mapSession(data.session);
                if (window.Pro) Pro.clearSession();
                updateAuthUI();
                App.toast(`Olá de novo, ${session.name.split(' ')[0]}!`, 'success');
                App.showPage('dashboard');
                upgradeName(data.session.user);
                return;
            }

            // ---- modo local ----
            const user = getUsers().find(u => u.email === email);
            if (!user || user.password !== hash(password)) {
                setFieldError('loginPasswordField', true);
                App.toast('E-mail ou senha incorretos.', 'error');
                return;
            }

            await delay(500);

            session = { id: user.id, name: user.name, email: user.email };
            writeLocalSession(session, $('#loginRemember').checked);
            DB.setLocalOwner(email);
            if (window.Pro) Pro.clearSession();

            form.reset();
            updateAuthUI();
            App.toast(`Olá de novo, ${session.name.split(' ')[0]}!`, 'success');
            App.showPage('dashboard');
        } catch (err) {
            App.toast(friendlyError(err), 'error');
        } finally {
            setBusy(button, false);
        }
    }

    /* ---------- Sair ---------- */
    async function logout() {
        if (hasSupabase()) {
            try {
                await client().auth.signOut();
            } catch (err) {
                console.error('[VuxPet] signOut:', err);
            }
        }
        clearSession();
        App.toast('Você saiu da sua conta.', 'warning');
        App.showPage('home');
    }

    /* ---------- Recuperar senha ---------- */
    async function forgotPassword() {
        const email = $('#loginEmail').value.trim();
        if (!EMAIL_REGEX.test(email)) {
            setFieldError('loginEmailField', true);
            App.toast('Informe seu e-mail para recuperar a senha.', 'error');
            return;
        }

        if (!hasSupabase()) {
            App.toast(`Link de recuperação enviado para ${email}.`, 'success');
            return;
        }

        try {
            const { error } = await client().auth.resetPasswordForEmail(email, {
                redirectTo: redirectUrl()
            });
            if (error) throw error;
            App.toast(`Confira seu e-mail: enviamos o link para ${email}.`, 'success');
        } catch (err) {
            App.toast(friendlyError(err), 'error');
        }
    }

    /* ---------- Login social ---------- */
    async function socialSignIn(provider) {
        if (!hasSupabase()) {
            App.toast(`Login com ${provider} disponível em breve.`, 'warning');
            return;
        }

        try {
            const { error } = await client().auth.signInWithOAuth({
                provider: provider.toLowerCase(),
                options: { redirectTo: redirectUrl() }
            });
            if (error) throw error;
        } catch (err) {
            App.toast(friendlyError(err), 'error');
        }
    }

    function redirectUrl() {
        const cfg = window.VUXPET_CONFIG || {};
        if (cfg.REDIRECT_URL) return cfg.REDIRECT_URL;
        const { href, origin } = window.location;
        return origin && origin !== 'null' ? origin + window.location.pathname : href;
    }

    /* ---------- Senha: visibilidade e força ---------- */
    function togglePassword(inputId) {
        const input = document.getElementById(inputId);
        const icon = document.querySelector(`[data-toggle-password="${inputId}"] i`);
        const showing = input.type === 'text';
        input.type = showing ? 'password' : 'text';
        icon.className = showing ? 'fa-regular fa-eye' : 'fa-regular fa-eye-slash';
    }

    function passwordStrength(password) {
        let score = 0;
        if (password.length >= 8) score++;
        if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score++;
        if (/\d/.test(password)) score++;
        if (/[^A-Za-z0-9]/.test(password)) score++;
        return password ? score : 0;
    }

    function updateStrengthUI() {
        const value = $('#regPassword').value;
        const level = passwordStrength(value);
        const labels = [
            'Use letras e números.',
            'Senha fraca',
            'Senha razoável',
            'Senha boa',
            'Senha forte'
        ];
        $('#passwordStrength').dataset.level = String(level);
        $('#strengthLabel').textContent = labels[level];
        $('#strengthLabel').style.color =
            level >= 4 ? 'var(--success)' : level >= 2 ? 'var(--warning)' : 'var(--gray)';
    }

    /* ---------- Hash local (apenas modo demo) ---------- */
    function hash(str) {
        let h = 5381;
        for (let i = 0; i < str.length; i++) {
            h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
        }
        return `vx$${h.toString(16)}`;
    }

    /* ---------- Sessão Supabase ---------- */
    let authListenerBound = false;
    let sessionRestoring = false;

    function bindAuthListener() {
        if (authListenerBound || !client) return;
        authListenerBound = true;

        client().auth.onAuthStateChange((event, snap) => {
            // Nunca usar await dentro deste callback (risco de deadlock).
            queueMicrotask(() => {
                if (!snap) {
                    if (session) clearSession();
                    return;
                }
                // A sessão do profissional é tratada pelo módulo Pro.
                if (isProfessionalMeta(snap.user)) return;
                if (!session || session.id !== snap.user.id) {
                    session = mapSession(snap);
                    if (window.Pro) Pro.clearSession();
                    updateAuthUI();
                    upgradeName(snap.user);
                }
            });
        });
    }

    /**
     * Restaura a sessão de cliente a partir do Supabase.
     * Se o usuário for profissional, a sessão fica com o módulo Pro.
     */
    async function restoreSupabaseSession() {
        if (sessionRestoring) return;
        sessionRestoring = true;
        try {
            const { data, error } = await client().auth.getSession();
            if (error) throw error;

            if (data && data.session && !isProfessionalMeta(data.session.user)) {
                const pro = await findProfessional(data.session.user.id);
                if (pro) {
                    if (window.Pro) Pro.claimSupabaseSession();
                } else {
                    session = mapSession(data.session);
                    updateAuthUI();
                    upgradeName(data.session.user);
                }
            }
        } catch (err) {
            console.error('[VuxPet] getSession:', err);
        } finally {
            sessionRestoring = false;
        }

        bindAuthListener();
    }

    /* ---------- Init ---------- */
    function init() {
        $('#tabLogin').addEventListener('click', () => setAuthTab('login'));
        $('#tabRegister').addEventListener('click', () => setAuthTab('register'));

        document.addEventListener('click', e => {
            const sw = e.target.closest('[data-switch]');
            if (sw) setAuthTab(sw.dataset.switch);

            const toggle = e.target.closest('[data-toggle-password]');
            if (toggle) togglePassword(toggle.dataset.togglePassword);

            const social = e.target.closest('[data-provider]');
            if (social) socialSignIn(social.dataset.provider);
        });

        $('#panelLogin').addEventListener('submit', login);
        $('#panelRegister').addEventListener('submit', register);

        $('#forgotPassword').addEventListener('click', e => {
            e.preventDefault();
            forgotPassword();
        });
        $('#footerForgot').addEventListener('click', e => {
            e.preventDefault();
            App.showPage('auth');
            setAuthTab('login');
            $('#loginEmail').focus();
        });

        $('#regPassword').addEventListener('input', updateStrengthUI);
        $('#regTerms').addEventListener('change', () => {
            $('#termsError').classList.remove('show');
        });
        $('#logoutBtn').addEventListener('click', e => {
            e.preventDefault();
            logout();
        });

        const fieldMap = {
            regName: 'regNameField',
            regEmail: 'regEmailField',
            regPassword: 'regPasswordField',
            regConfirm: 'regConfirmField',
            loginEmail: 'loginEmailField',
            loginPassword: 'loginPasswordField'
        };

        Object.entries(fieldMap).forEach(([inputId, fieldId]) => {
            document.getElementById(inputId).addEventListener('input', () => {
                setFieldError(fieldId, false);
            });
        });

        if (hasSupabase()) {
            restoreSupabaseSession();
        } else {
            session = readLocalSession();
            if (session) DB.setLocalOwner(session.email);
        }

        updateAuthUI();
    }

    return {
        init,
        getSession,
        clearSession,
        logout,
        setAuthTab,
        restoreSupabaseSession
    };
})();

window.Auth = Auth;
