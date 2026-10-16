/* ============================================================
   VuxPet — data.js
   Cliente Supabase + repositórios (pets, agendamentos, clínicas).

   Escopo dos dados (espelha as políticas RLS):
   • Cliente logado  → vê apenas os próprios registros.
   • Profissional    → vê os registros da sua clínica.
   • Sem credenciais → fallback local (localStorage).
   ============================================================ */

const DB = (() => {
    'use strict';

    const cfg = window.VUXPET_CONFIG || {};
    const url = String(cfg.SUPABASE_URL || '').trim();
    const anonKey = String(cfg.SUPABASE_ANON_KEY || '').trim();

    const isPlaceholder = /SEU-PROJETO|COLE_AQUI/i.test(url + anonKey);
    const hasCredentials =
        /^https:\/\/[^\s]+\.supabase\.(co|in)$/.test(url) && anonKey.length > 30;

    let client = null;
    if (!isPlaceholder && hasCredentials && typeof window.supabase !== 'undefined') {
        try {
            client = window.supabase.createClient(url, anonKey, {
                auth: {
                    persistSession: true,
                    autoRefreshToken: true,
                    detectSessionInUrl: true
                }
            });
        } catch (err) {
            console.error('[VuxPet] Falha ao criar cliente Supabase:', err);
            client = null;
        }
    }

    /* ---------- Storage (com fallback em memória) ---------- */
    const memory = new Map();

    function backend(scope) {
        const memKey = k => `${scope}:${k}`;

        function resolve() {
            try {
                return scope === 'session' ? window.sessionStorage : window.localStorage;
            } catch {
                return null;
            }
        }

        return {
            getRaw(key) {
                const target = resolve();
                if (target) {
                    try {
                        return target.getItem(key);
                    } catch { /* segue para memória */ }
                }
                return memory.has(memKey(key)) ? memory.get(memKey(key)) : null;
            },
            setRaw(key, value) {
                memory.set(memKey(key), value);
                const target = resolve();
                if (target) {
                    try {
                        target.setItem(key, value);
                    } catch { /* modo privado / origem opaca */ }
                }
            },
            removeRaw(key) {
                memory.delete(memKey(key));
                const target = resolve();
                if (target) {
                    try {
                        target.removeItem(key);
                    } catch { /* ignora */ }
                }
            },
            keys() {
                const target = resolve();
                if (!target) return [];
                try {
                    return Object.keys(target);
                } catch {
                    return [];
                }
            }
        };
    }

    const storage = {
        local: backend('local'),
        session: backend('session'),
        get(key, fallback) {
            try {
                const raw = storage.local.getRaw(key);
                return raw ? JSON.parse(raw) : fallback;
            } catch {
                return fallback;
            }
        },
        set(key, value) {
            storage.local.setRaw(key, JSON.stringify(value));
        },
        remove(key) {
            storage.local.removeRaw(key);
        }
    };

    /* ---------- Escopo local (quem está logado) ---------- */
    const KEYS = {
        pets: 'vuxpet:pets',
        appointments: 'vuxpet:appointments',
        pros: 'vuxpet:pros'
    };

    let localOwner = null;
    let localClinic = null;

    function setLocalOwner(owner) {
        localOwner = owner || null;
        if (localOwner) localClinic = null;
    }

    function setLocalClinic(clinic) {
        localClinic = clinic || null;
        if (localClinic) localOwner = null;
    }

    function clearLocalScope() {
        localOwner = null;
        localClinic = null;
    }

    /* ---------- Identificadores ---------- */
    function uid() {
        if (window.crypto && typeof window.crypto.randomUUID === 'function') {
            return window.crypto.randomUUID();
        }
        return `vx-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
    }

    const PG_ERRORS = {
        '42501': 'Sem permissão para acessar estes dados.',
        '23502': 'Sessão inválida. Saia e entre novamente.',
        '23503': 'Registro relacionado não encontrado.',
        '23505': 'Este registro já existe.',
        'PGRST116': 'Registro não encontrado.'
    };

    function throwIf(error, context) {
        if (!error) return;

        const msg = String(error.message || '');
        let userMessage = PG_ERRORS[error.code] || null;

        if (!userMessage && /failed to fetch|networkerror|load failed/i.test(msg)) {
            userMessage = 'Falha de conexão com o servidor.';
        }
        if (!userMessage && /row-level security|permission denied/i.test(msg)) {
            userMessage = 'Sem permissão para acessar estes dados.';
        }
        if (!userMessage && /relation .* does not exist/i.test(msg)) {
            userMessage = 'Banco não configurado. Execute o arquivo sql/schema.sql.';
        }

        const err = new Error(userMessage || 'Não foi possível concluir a operação.');
        err.code = error.code;
        err.context = context;
        err.detail = msg;
        throw err;
    }

    const PET_COLUMNS = 'id, name, species, breed, age, created_at';
    const APPT_COLUMNS =
        'id, pet_id, pet_name, pet_species, tutor_name, vaccine, date, time, clinic, notes, status, created_at';

    /**
     * Colunas que o banco atual não possui (schema desatualizado).
     * São descartadas da consulta/insert automaticamente, sem quebrar o app,
     * até que o sql/schema.sql (ALTER TABLE) seja executado no Supabase.
     */
    const apptUnavailable = new Set();

    function apptColumns() {
        return APPT_COLUMNS
            .split(',')
            .map(c => c.trim())
            .filter(c => c && !apptUnavailable.has(c))
            .join(', ');
    }

    /** Reconhece "column X does not exist" (42703) e devolve o nome da coluna. */
    function missingColumn(error) {
        if (!error || String(error.code) !== '42703') return null;
        const m = /column\s+"?([\w.]+)"?(?:\s+of\s+relation\s+"?[\w]+"?)?\s+does not exist/i
            .exec(String(error.message || ''));
        return m ? m[1].split('.').pop() : null;
    }

    /** Executa uma query de agendamentos re-tentando sem colunas inexistentes. */
    async function withApptColumns(run) {
        let result;
        for (let i = 0; i <= 6; i++) {
            result = await run(apptColumns());
            if (!result.error) return result;
            const col = missingColumn(result.error);
            if (!col || apptUnavailable.has(col)) return result;
            apptUnavailable.add(col);
        }
        return result;
    }

    /* ---------- PETS ---------- */
    const pets = {
        async list() {
            if (!client) {
                if (!localOwner) return [];
                return storage.get(KEYS.pets, []).filter(p => p.ownerEmail === localOwner);
            }
            const { data, error } = await client
                .from('pets')
                .select(PET_COLUMNS)
                .order('created_at', { ascending: true });
            throwIf(error, 'pets.list');
            return data || [];
        },

        async create(payload) {
            if (!client) {
                const pet = { id: uid(), ownerEmail: localOwner, ...payload };
                const all = storage.get(KEYS.pets, []);
                all.push(pet);
                storage.set(KEYS.pets, all);
                return pet;
            }
            const { data, error } = await client
                .from('pets')
                .insert({
                    name: payload.name,
                    species: payload.species,
                    breed: payload.breed || null,
                    age: payload.age || null
                })
                .select(PET_COLUMNS)
                .single();
            throwIf(error, 'pets.create');
            return data;
        },

        async remove(id) {
            if (!client) {
                const all = storage.get(KEYS.pets, []);
                storage.set(KEYS.pets, all.filter(p => p.id !== id));
                return;
            }
            const { error } = await client.from('pets').delete().eq('id', id);
            throwIf(error, 'pets.remove');
        }
    };

    /* ---------- AGENDAMENTOS ---------- */
    function mapAppointment(row) {
        return {
            id: row.id,
            pet: row.pet_name,
            petId: row.pet_id,
            petSpecies: row.pet_species || '',
            tutorName: row.tutor_name || 'Tutor',
            vaccine: row.vaccine,
            date: row.date,
            time: row.time,
            clinic: row.clinic,
            notes: row.notes || '',
            status: row.status,
            createdAt: row.created_at
        };
    }

    function mapLocalAppointment(row) {
        return {
            id: row.id,
            pet: row.petName,
            petId: row.petId,
            petSpecies: row.petSpecies || '',
            tutorName: row.tutorName || 'Tutor',
            vaccine: row.vaccine,
            date: row.date,
            time: row.time,
            clinic: row.clinic,
            notes: row.notes || '',
            status: row.status,
            createdAt: row.createdAt
        };
    }

    const appointments = {
        /** Tudo que o usuário atual tem permissão de ver. */
        async list() {
            if (!client) {
                const all = storage.get(KEYS.appointments, []);
                if (localClinic) return all.filter(a => a.clinic === localClinic).map(mapLocalAppointment);
                if (!localOwner) return [];
                return all.filter(a => a.ownerEmail === localOwner).map(mapLocalAppointment);
            }
            const { data, error } = await withApptColumns(cols => client
                .from('appointments')
                .select(cols)
                .order('date', { ascending: false })
                .order('time', { ascending: true }));
            throwIf(error, 'appointments.list');
            let result = (data || []).map(mapAppointment);
            if (localClinic) result = result.filter(a => a.clinic === localClinic);
            return result;
        },

        async create(payload) {
            if (!client) {
                const appt = {
                    id: uid(),
                    ownerEmail: localOwner,
                    petId: payload.petId,
                    petName: payload.petName,
                    petSpecies: payload.petSpecies || '',
                    tutorName: payload.tutorName || 'Tutor',
                    vaccine: payload.vaccine,
                    date: payload.date,
                    time: payload.time,
                    clinic: payload.clinic,
                    notes: payload.notes || '',
                    status: payload.status || 'Agendada',
                    createdAt: new Date().toISOString()
                };
                const all = storage.get(KEYS.appointments, []);
                all.push(appt);
                storage.set(KEYS.appointments, all);
                return mapLocalAppointment(appt);
            }
            const row = {
                pet_id: payload.petId,
                pet_name: payload.petName,
                pet_species: payload.petSpecies || null,
                tutor_name: payload.tutorName || null,
                vaccine: payload.vaccine,
                date: payload.date,
                time: payload.time,
                clinic: payload.clinic,
                notes: payload.notes || null,
                status: payload.status || 'Agendada'
            };
            const { data, error } = await withApptColumns(async cols => {
                Object.keys(row).forEach(k => {
                    if (apptUnavailable.has(k)) delete row[k];
                });
                return client
                    .from('appointments')
                    .insert(row)
                    .select(cols)
                    .single();
            });
            throwIf(error, 'appointments.create');
            return mapAppointment(data);
        },

        async remove(id) {
            if (!client) {
                const all = storage.get(KEYS.appointments, []);
                const target = all.find(a => a.id === id);
                if (!target) throw new Error('Agendamento não encontrado.');
                if (localOwner && target.ownerEmail !== localOwner) {
                    throw new Error('Sem permissão para remover este agendamento.');
                }
                if (localClinic && target.clinic !== localClinic) {
                    throw new Error('Sem permissão para remover este agendamento.');
                }
                storage.set(KEYS.appointments, all.filter(a => a.id !== id));
                return;
            }
            const { error } = await client
                .from('appointments')
                .delete()
                .eq('id', id);
            throwIf(error, 'appointments.remove');
        },

        async updateStatus(id, status) {
            if (!client) {
                const all = storage.get(KEYS.appointments, []);
                const target = all.find(a => a.id === id);
                if (!target) throw new Error('Agendamento não encontrado.');
                if (localClinic && target.clinic !== localClinic) {
                    throw new Error('Sem permissão para alterar este agendamento.');
                }
                target.status = status;
                storage.set(KEYS.appointments, all);
                return mapLocalAppointment(target);
            }
            const { data, error } = await withApptColumns(cols => client
                .from('appointments')
                .update({ status })
                .eq('id', id)
                .select(cols)
                .single());
            throwIf(error, 'appointments.updateStatus');
            return mapAppointment(data);
        }
    };

    return {
        client,
        isConfigured: Boolean(client),
        keys: KEYS,
        storage,
        setLocalOwner,
        setLocalClinic,
        clearLocalScope,
        pets,
        appointments
    };
})();

window.DB = DB;
