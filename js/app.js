/* ============================================================
   VuxPet — app.js
   Navegação SPA, modais, pets, agendamentos e histórico.
   ============================================================ */

const App = (() => {
    'use strict';

    const $  = (sel, ctx = document) => ctx.querySelector(sel);
    const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));

    const PAGES = ['home', 'auth', 'dashboard', 'schedule', 'history', 'pro'];
    const PRIVATE_PAGES = ['dashboard', 'schedule', 'history'];

    /* ---------- Status de agendamento ---------- */
    const STATUS = {
        Agendada:   { badge: 'badge-info' },
        Confirmada: { badge: 'badge-warning' },
        Concluída:  { badge: 'badge-success' },
        Cancelada:  { badge: 'badge-danger' }
    };

    function statusBadge(status) {
        return (STATUS[status] || STATUS.Agendada).badge;
    }

    function isActive(status) {
        return status === 'Agendada' || status === 'Confirmada';
    }

    /* ---------- Toasts ---------- */
    function toast(message, type = 'success') {
        const icons = {
            success: 'fa-circle-check',
            error:   'fa-circle-xmark',
            warning: 'fa-triangle-exclamation'
        };
        const el = document.createElement('div');
        el.className = `toast toast-${type}`;
        el.innerHTML = `<i class="fas ${icons[type] || icons.success}"></i><span></span>`;
        el.querySelector('span').textContent = message;

        $('#toastContainer').appendChild(el);

        setTimeout(() => {
            el.style.transition = 'opacity .3s ease, transform .3s ease';
            el.style.opacity = '0';
            el.style.transform = 'translateY(20px)';
            setTimeout(() => el.remove(), 320);
        }, 3500);
    }

    function notifyError(err, fallback = 'Não foi possível concluir a operação.') {
        console.error('[VuxPet]', err && err.detail ? err.detail : err);
        toast(err && err.message ? err.message : fallback, 'error');
    }

    /* ---------- Navegação ---------- */
    function showPage(name) {
        if (!PAGES.includes(name)) name = 'home';

        if (PRIVATE_PAGES.includes(name) && !Auth.getSession()) {
            toast('Faça login para acessar essa área.', 'warning');
            name = 'auth';
            setAuthTab('login');
        }

        PAGES.forEach(page => {
            const el = $(`#page-${page}`);
            if (el) el.classList.toggle('hidden', page !== name);
        });

        $$('#navLinks a').forEach(a => {
            a.classList.toggle('active', a.dataset.page === name);
        });

        $('#navLinks').classList.remove('open');
        window.scrollTo({ top: 0, behavior: 'smooth' });

        if (name === 'dashboard') renderDashboard();
        if (name === 'schedule') renderPetSelect();
        if (name === 'history') renderHistory();
        if (name === 'pro' && window.Pro) Pro.renderPanel();
    }

    function setAuthTab(tab) {
        if (window.Auth) Auth.setAuthTab(tab);
    }

    function toggleMobileMenu() {
        $('#navLinks').classList.toggle('open');
    }

    /* ---------- Modais ---------- */
    function openModal(id) {
        const modal = document.getElementById(id);
        if (modal) modal.classList.add('active');
    }

    function closeModal(modal) {
        modal.classList.remove('active');
    }

    /* ---------- Dashboard ---------- */
    const SPECIES_ICON = { Cachorro: 'fa-dog', Gato: 'fa-cat', Outro: 'fa-paw' };

    function loadingState(label) {
        return `
            <div class="empty-state">
                <span class="loading" style="margin:0 auto 8px;"></span>
                <div>${label}</div>
            </div>`;
    }

    function renderDashboard() {
        const user = Auth.getSession();
        if (!user) return;

        $('#dashboardUserName').textContent = user.name.split(' ')[0];
        renderPets();
        renderUpcoming();
    }

    async function renderPets() {
        const list = $('#petList');
        list.innerHTML = loadingState('Carregando pets...');

        try {
            const pets = await DB.pets.list();

            if (!pets.length) {
                list.innerHTML = `
                    <div class="empty-state">
                        <i class="fas fa-paw"></i>
                        Nenhum pet cadastrado ainda.
                    </div>`;
                return;
            }

            list.innerHTML = pets.map(pet => `
                <div class="pet-card">
                    <div class="pet-avatar"><i class="fas ${SPECIES_ICON[pet.species] || 'fa-paw'}"></i></div>
                    <div class="pet-info">
                        <h4>${escapeHtml(pet.name)}</h4>
                        <p>${escapeHtml(pet.species)}${pet.breed ? ' · ' + escapeHtml(pet.breed) : ''}${pet.age ? ' · ' + escapeHtml(pet.age) : ''}</p>
                    </div>
                    <button class="pet-remove" data-remove-pet="${escapeHtml(pet.id)}" title="Remover pet">
                        <i class="fas fa-trash-alt"></i>
                    </button>
                </div>
            `).join('');
        } catch (err) {
            list.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-triangle-exclamation"></i>
                    Erro ao carregar seus pets.
                </div>`;
            notifyError(err, 'Erro ao carregar os pets.');
        }
    }

    async function renderUpcoming() {
        const box = $('#upcomingVaccines');
        const banner = $('#reminderBanner');
        banner.classList.add('hidden');
        box.innerHTML = loadingState('Carregando agenda...');

        try {
            const appts = (await DB.appointments.list())
                .filter(a => isActive(a.status))
                .sort((a, b) => a.date.localeCompare(b.date));

            if (!appts.length) {
                box.innerHTML = `
                    <div class="empty-state">
                        <i class="fas fa-calendar-xmark"></i>
                        Nenhuma vacina agendada.
                    </div>`;
                banner.classList.add('hidden');
                return;
            }

            banner.classList.remove('hidden');
            const next = appts[0];
            $('#reminderPetName').textContent = next.pet;
            $('#reminderVaccine').textContent = next.vaccine;
            $('#reminderDays').textContent = daysUntil(next.date);

            box.innerHTML = appts.map(a => `
                <div class="vaccine-item">
                    <div class="vaccine-info">
                        <h4>${escapeHtml(a.vaccine)}</h4>
                        <p>
                            <i class="fas fa-paw"></i> ${escapeHtml(a.pet)} ·
                            <i class="fas fa-calendar"></i> ${formatDate(a.date)} ·
                            <i class="fas fa-clock"></i> ${escapeHtml(a.time)}
                        </p>
                    </div>
                    <span class="badge ${daysUntil(a.date) <= 7 ? 'badge-warning' : 'badge-info'}">
                        ${escapeHtml(a.clinic)}
                    </span>
                </div>
            `).join('');
        } catch (err) {
            box.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-triangle-exclamation"></i>
                    Não foi possível carregar a agenda.
                </div>`;
            banner.classList.add('hidden');
            notifyError(err, 'Erro ao carregar os agendamentos.');
        }
    }

    /* ---------- Agendamento ---------- */
    async function renderPetSelect() {
        const select = $('#schedulePetSelect');
        const current = select.value;
        const previous = select.innerHTML;

        try {
            const pets = await DB.pets.list();

            select.innerHTML = '<option value="">-- Selecione um pet --</option>' +
                pets.map(p =>
                    `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)} (${escapeHtml(p.species)})</option>`
                ).join('');

            if (pets.some(p => p.id === current)) select.value = current;

            if (!pets.length) {
                toast('Cadastre um pet antes de agendar uma vacina.', 'warning');
            }
        } catch (err) {
            select.innerHTML = previous;
            notifyError(err, 'Erro ao carregar os pets.');
        }
    }

    async function handleScheduleSubmit(e) {
        e.preventDefault();

        if (!Auth.getSession()) {
            toast('Faça login para agendar.', 'warning');
            showPage('auth');
            return;
        }

        const petId    = $('#schedulePetSelect').value;
        const vaccine  = $('#scheduleVaccineSelect').value;
        const date     = $('#scheduleDate').value;
        const clinic   = $('#scheduleClinic').value;
        const time     = $('#scheduleTime').value;

        if (!petId || !vaccine || !date || !clinic) {
            toast('Preencha todos os campos obrigatórios.', 'error');
            return;
        }
        if (!time) {
            toast('Selecione um horário disponível.', 'error');
            return;
        }

        const submitBtn = e.target.querySelector('button[type="submit"]');
        setBusy(submitBtn, true, 'Confirmando...');

        try {
            const pets = await DB.pets.list();
            const pet = pets.find(p => p.id === petId);
            if (!pet) {
                toast('Pet não encontrado. Atualize a lista.', 'error');
                return;
            }

            await DB.appointments.create({
                petId: pet.id,
                petName: pet.name,
                petSpecies: pet.species,
                tutorName: (Auth.getSession() || {}).name || 'Tutor',
                vaccine,
                date,
                time,
                clinic,
                notes: $('#scheduleNotes').value.trim(),
                status: 'Agendada'
            });

            e.target.reset();
            $('#scheduleTime').value = '';
            $$('.slot-btn').forEach(s => s.classList.remove('selected'));

            toast(`Vacina ${vaccine} agendada para ${pet.name} em ${formatDate(date)} às ${time}.`);
            showPage('dashboard');
        } catch (err) {
            notifyError(err, 'Não foi possível agendar.');
        } finally {
            setBusy(submitBtn, false);
        }
    }

    function setBusy(button, busy, label) {
        if (!button) return;
        if (busy) {
            button.dataset.original = button.innerHTML;
            button.disabled = true;
            button.innerHTML = `<span class="loading"></span> ${label}`;
        } else {
            button.disabled = false;
            if (button.dataset.original) button.innerHTML = button.dataset.original;
        }
    }

    /* ---------- Histórico ---------- */
    async function renderHistory() {
        const box = $('#historyList');
        box.innerHTML = loadingState('Carregando histórico...');

        try {
            const appts = (await DB.appointments.list())
                .sort((a, b) => b.date.localeCompare(a.date));

            if (!appts.length) {
                box.innerHTML = `
                    <div class="empty-state">
                        <i class="fas fa-file-medical"></i>
                        Nenhum registro encontrado ainda.
                    </div>`;
                return;
            }

            box.innerHTML = `
                <div class="timeline">
                    ${appts.map(a => `
                        <div class="timeline-item">
                            <div class="date">${formatDate(a.date)} · ${escapeHtml(a.time)}</div>
                            <div class="title">${escapeHtml(a.vaccine)} — ${escapeHtml(a.pet)}</div>
                            <div style="font-size:13px;color:var(--gray);">
                                <i class="fas fa-location-dot"></i> ${escapeHtml(a.clinic)}
                                ${a.tutorName ? ' · <i class="fa-regular fa-user"></i> ' + escapeHtml(a.tutorName) : ''}
                            </div>
                            <div class="timeline-item-footer">
                                <span class="badge ${statusBadge(a.status)}">
                                    ${escapeHtml(a.status)}
                                </span>
                                <button type="button" class="appt-remove" data-remove-appt="${escapeHtml(a.id)}" title="Excluir do histórico">
                                    <i class="fas fa-trash-alt"></i>
                                </button>
                            </div>
                        </div>`).join('')}
                </div>`;
        } catch (err) {
            box.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-triangle-exclamation"></i>
                    Não foi possível carregar o histórico.
                </div>`;
            notifyError(err, 'Erro ao carregar o histórico.');
        }
    }

    /* ---------- Mapa: destaque de clínica ---------- */
    function toggleClinic(id) {
        const container = $('#mapContainer');
        if (!container) return;

        const pins = $$('.pin', container);
        const items = $$('.legend-item[data-clinic]', container);
        const target = pins.find(p => p.dataset.clinic === id);
        const isActive = target && target.classList.contains('active');

        pins.forEach(p => p.classList.remove('active'));
        items.forEach(i => i.classList.remove('active'));

        if (target && !isActive) {
            target.classList.add('active');
            items.filter(i => i.dataset.clinic === id).forEach(i => i.classList.add('active'));
            container.classList.add('has-active');
        } else {
            container.classList.remove('has-active');
        }
    }

    /* ---------- Helpers ---------- */
    function escapeHtml(str) {
        return String(str ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function formatDate(iso) {
        if (!iso) return '';
        const [y, m, d] = iso.split('-');
        return `${d}/${m}/${y}`;
    }

    function daysUntil(iso) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const target = new Date(`${iso}T00:00:00`);
        return Math.max(0, Math.ceil((target - today) / 86400000));
    }

    function todayISO() {
        const d = new Date();
        const p = n => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
    }

    /* ---------- Eventos globais ---------- */
    function bindEvents() {
        document.addEventListener('click', async e => {
            const pageLink = e.target.closest('[data-page]');
            if (pageLink) {
                e.preventDefault();
                if (pageLink.dataset.authTab) setAuthTab(pageLink.dataset.authTab);
                showPage(pageLink.dataset.page);
                return;
            }

            const modalTrigger = e.target.closest('[data-modal]');
            if (modalTrigger) {
                openModal(modalTrigger.dataset.modal);
                return;
            }

            const closer = e.target.closest('[data-close]');
            if (closer) {
                closeModal(closer.closest('.modal-overlay'));
                return;
            }

            if (e.target.classList.contains('modal-overlay')) {
                closeModal(e.target);
                return;
            }

            const slot = e.target.closest('.slot-btn');
            if (slot && !slot.disabled) {
                $$('.slot-btn').forEach(s => s.classList.remove('selected'));
                slot.classList.add('selected');
                $('#scheduleTime').value = slot.textContent.trim();
                return;
            }

            const clinic = e.target.closest('[data-clinic]');
            if (clinic) {
                e.preventDefault();
                toggleClinic(clinic.dataset.clinic);
                return;
            }

            const removeAppt = e.target.closest('[data-remove-appt]');
            if (removeAppt) {
                const id = removeAppt.dataset.removeAppt;
                if (!window.confirm('Excluir este agendamento do histórico?')) return;
                try {
                    removeAppt.disabled = true;
                    await DB.appointments.remove(id);
                    await renderHistory();
                    toast('Agendamento excluído do histórico.', 'warning');
                } catch (err) {
                    removeAppt.disabled = false;
                    notifyError(err, 'Não foi possível excluir o agendamento.');
                }
            }

            const removePet = e.target.closest('[data-remove-pet]');
            if (removePet) {
                const id = removePet.dataset.removePet;
                try {
                    const pets = await DB.pets.list();
                    const removed = pets.find(p => p.id === id);
                    await DB.pets.remove(id);
                    await Promise.all([renderPets(), renderPetSelect()]);
                    toast(`${removed ? removed.name : 'Pet'} removido dos seus pets.`, 'warning');
                } catch (err) {
                    notifyError(err, 'Não foi possível remover o pet.');
                }
            }
        });

        document.addEventListener('keydown', e => {
            if (e.key === 'Escape') {
                $$('.modal-overlay.active').forEach(closeModal);
                $('#navLinks').classList.remove('open');
            }
        });

        $('#mobileMenuBtn').addEventListener('click', toggleMobileMenu);

        $('#petForm').addEventListener('submit', async e => {
            e.preventDefault();

            const name = $('#petName').value.trim();
            const species = $('#petSpecies').value;

            if (name.length < 2 || !species) {
                toast('Informe o nome e a espécie do pet.', 'error');
                return;
            }

            const submitBtn = e.target.querySelector('button[type="submit"]');
            setBusy(submitBtn, true, 'Salvando...');

            try {
                await DB.pets.create({
                    name,
                    species,
                    breed: $('#petBreed').value.trim(),
                    age: $('#petAge').value.trim()
                });

                e.target.reset();
                closeModal($('#petModal'));
                await Promise.all([renderPets(), renderPetSelect()]);
                toast(`${name} cadastrado com sucesso!`);
            } catch (err) {
                notifyError(err, 'Não foi possível salvar o pet.');
            } finally {
                setBusy(submitBtn, false);
            }
        });

        $('#scheduleForm').addEventListener('submit', handleScheduleSubmit);
    }

    /* ---------- Init ---------- */
    function init() {
        $('#scheduleDate').min = todayISO();
        $('#year').textContent = new Date().getFullYear();

        bindEvents();
        showPage('home');
    }

    return {
        init,
        toast,
        showPage,
        openModal,
        renderDashboard,
        renderPetSelect,
        renderHistory,
        escapeHtml,
        formatDate,
        daysUntil,
        todayISO,
        STATUS,
        statusBadge,
        isActive
    };
})();

window.App = App;

document.addEventListener('DOMContentLoaded', () => {
    App.init();
    if (window.Auth) Auth.init();
});
