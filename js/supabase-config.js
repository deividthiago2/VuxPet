/* ============================================================
   VuxPet — CONFIGURAÇÃO DO SUPABASE
   ------------------------------------------------------------
   COMO CONFIGURAR (2 minutos):
   1. Acesse https://supabase.com e crie um projeto gratuito.
   2. Em "Project Settings > API" copie:
        • Project URL  -> SUPABASE_URL
        • anon public key -> SUPABASE_ANON_KEY
   3. Cole os valores abaixo (substitua os placeholders).
   4. No "SQL Editor" do Supabase, execute o arquivo sql/schema.sql
      (cria as tabelas profiles, pets e appointments + políticas).
   5. Em "Authentication > Providers > Email", desative
      "Confirm email" (ou configure o Redirect URL) se quiser
      entrar imediatamente após o cadastro.

   Enquanto os placeholders estiverem aqui, o app roda em modo
   DEMO: login/cadastro e dados ficam apenas no navegador.
   ============================================================ */

window.VUXPET_CONFIG = {
    /* Ex.: https://abcdefghij.supabase.co */
    SUPABASE_URL: 'https://kourjlmzeestcqywyjyl.supabase.co',

    /* Cole a chave "anon public" (eyJhbGciOi...) */
    SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtvdXJqbG16ZWVzdGNxeXd5anlsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE0NTk3NTYsImV4cCI6MjEwNzAzNTc1Nn0.IrEEGSHbfAQR5-44d821XYx0c1I5B025uJ-aUijaISw',

    /* URL de retorno após confirmação de e-mail / redefinição de senha.
       Deixe vazio para usar a URL atual da página. */
    REDIRECT_URL: ''
};
