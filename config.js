
/* =====================================
   SKINWALKER: THE HUNT
   SUPABASE AUTH CONFIGURATION
===================================== */

(() => {
  const CONFIG = {
    url: "https://twsyqidzbgwidjnffhfb.supabase.co",
    key: "sb_publishable_jkNeW0TBQTZ8VcEAudYAbw_xOt5ZVuQ"
  };

  if (!window.supabase) {
    console.error("Supabase SDK failed to load.");
    window.authReady = false;
    return;
  }

  const client = window.supabase.createClient(
    CONFIG.url,
    CONFIG.key,
    {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true
      }
    }
  );

  window.supabaseClient = client;
  window.authReady = true;

  window.Auth = {
    user: null,

    async initialize() {
      const { data, error } = await client.auth.getSession();

      if (error) throw error;

      this.user = data.session?.user || null;

      client.auth.onAuthStateChange((event, session) => {
        this.user = session?.user || null;

        window.dispatchEvent(new CustomEvent("authChanged", {
          detail: {
            event,
            user: this.user
          }
        }));
      });

      return this.user;
    },

    async signup(email, password) {
      email = email.trim();

      if (!email || !password) {
        throw new Error("Email and password are required.");
      }

      if (password.length < 6) {
        throw new Error("Password must be at least 6 characters.");
      }

      const { data, error } = await client.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: window.location.origin
        }
      });

      if (error) throw error;

      this.user = data.user;

      return {
        user: data.user,
        session: data.session,
        verified: !!data.session,
        message: data.session
          ? "Account created successfully."
          : "Check your email to verify your account."
      };
    },

    async login(email, password) {
      email = email.trim();

      if (!email || !password) {
        throw new Error("Enter your email and password.");
      }

      const { data, error } = await client.auth.signInWithPassword({
        email,
        password
      });

      if (error) throw error;

      this.user = data.user;

      return data.user;
    },

    async logout() {
      const { error } = await client.auth.signOut();

      if (error) throw error;

      this.user = null;
    },

    async getUser() {
      const { data, error } = await client.auth.getUser();

      if (error) throw error;

      this.user = data.user;
      return data.user;
    }
  };

  console.log("Skinwalker authentication initialized.");
})();
