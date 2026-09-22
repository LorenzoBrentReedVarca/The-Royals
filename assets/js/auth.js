/* ==========================================================================
   THE ROYALS — auth.js
   Guest accounts, backed by Supabase.

   Runs on two pages and does a different job on each:

     account.html       sign in, create an account, recover a forgotten
                        password, and the signed-in card
     reservations.html  fills the booking form in for a guest who is already
                        signed in, and remembers their phone number for next
                        time

   ------------------------------------------------------------------------
   THE CONNECTION
   Project: oprbqvvtephbtwxqrops, owned by theroyalseminent@gmail.com
   Dashboard -> Project Settings -> API is where both values below come from.

   The publishable key is meant to be public and is safe in client-side code
   and safe in this repository. It is not a secret, and it grants only what
   Row Level Security allows. The secret key (sb_secret_...) is the dangerous
   one: it must never appear in a file the browser can read.

   There is no build step on this site, so nothing would substitute an
   environment variable at deploy time. The values live here, in the file the
   browser loads, which is where a publishable key belongs.
   ========================================================================== */
(function () {
  'use strict';

  var SUPABASE = {
    url: 'https://oprbqvvtephbtwxqrops.supabase.co',
    anonKey: 'sb_publishable_Vns42KhVjgvjI9ujim-oZQ_6gWhlRdw'
  };

  var SDK = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js';

  var $  = function (s, c) { return (c || document).querySelector(s); };
  var $$ = function (s, c) { return Array.prototype.slice.call((c || document).querySelectorAll(s)); };
  var on = function (el, ev, fn) { if (el) el.addEventListener(ev, fn); };

  var root    = $('[data-auth]');            // the account page
  var booking = $('#reservation-form');      // the reservations page
  if (!root && !booking) return;

  var configured = !!(SUPABASE.url && SUPABASE.anonKey);
  var client = null;

  /* Set while the guest is here from a reset link and has not yet chosen a new
     password. It keeps the signed-in card from taking over the page: they have
     a session, but showing them their membership date is not what they came
     for. */
  var recovering = /[#&]type=recovery/.test(window.location.hash);

  /* ---------- small helpers ---------- */

  /* Each card carries its own pair of notes, so a message raised while the
     new-password card is open must not be written into the hidden sign-in
     card where nobody will read it. */
  function notesHost() {
    var panels = $$('[data-auth-panel]', root);
    for (var i = 0; i < panels.length; i++) {
      if (!panels[i].hidden) return panels[i];
    }
    return root;
  }

  function note(kind, html) {
    var host = notesHost();
    if (!host) return;
    $$('.form-note', root).forEach(function (n) { n.classList.remove('is-shown'); });
    var el = $('.form-note--' + kind, host);
    if (!el) return;
    var body = $('[data-note-body]', el);
    if (body && html) body.innerHTML = html;
    el.classList.add('is-shown');
  }

  function clearNotes() {
    if (!root) return;
    $$('.form-note', root).forEach(function (n) { n.classList.remove('is-shown'); });
  }

  /* The submit buttons carry an arrow <svg> beside their label, so the busy
     state swaps the whole of the button's markup and puts the original back
     afterwards. Writing to textContent would delete the icon for good. */
  function busy(form, state) {
    var btn = $('[type="submit"]', form);
    if (!btn) return;
    if (state) {
      if (btn.getAttribute('data-label') === null) btn.setAttribute('data-label', btn.innerHTML);
      btn.innerHTML = btn.getAttribute('data-busy') || 'Working…';
    } else if (btn.getAttribute('data-label') !== null) {
      btn.innerHTML = btn.getAttribute('data-label');
    }
    btn.disabled = state;
    btn.classList.toggle('is-busy', state);
  }

  function showPanel(name) {
    $$('[data-auth-panel]', root).forEach(function (p) {
      p.hidden = p.getAttribute('data-auth-panel') !== name;
    });
  }

  /* Sign in, create account and the reset request share one card. The tabs
     only name two of them; the third is reached from the "forgotten your
     password" link, so it has no tab to light up. */
  function showForm(key) {
    $$('[data-auth-form]', root).forEach(function (f) {
      f.hidden = f.getAttribute('data-auth-form') !== key;
    });
    $$('[data-auth-tab]', root).forEach(function (b) {
      var active = b.getAttribute('data-auth-tab') === key;
      b.classList.toggle('is-active', active);
      b.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    clearNotes();
  }

  /* Supabase phrases a few failures for developers rather than for guests. */
  function humanise(message) {
    var m = String(message || '');
    if (/invalid login credentials/i.test(m)) return 'That email and password do not match an account.';
    if (/email not confirmed/i.test(m)) return 'Please confirm your email address first — check your inbox for the link.';
    if (/user already registered|already been registered/i.test(m)) return 'There is already an account with that email. Try signing in instead.';
    if (/rate limit|too many requests|for security purposes/i.test(m)) return 'Too many attempts just now. Please wait a minute and try again.';
    if (/failed to fetch|network/i.test(m)) return 'We could not reach the server. Check your connection and try again.';
    if (/same as the old|should be different/i.test(m)) return 'Please choose a password you have not used before.';
    /* When the mail server refuses, the account is not created and the guest
       can do nothing about it. Give them the door that always works. */
    if (/error sending|sending .*email|smtp/i.test(m)) {
      return 'We could not send that email just now. Please try again shortly — ' +
             'or message us on <a href="/whatsapp" style="color:var(--gold)">WhatsApp</a> ' +
             'and we will arrange your table directly.';
    }
    return m;
  }

  /* ---------- wiring that must work before the SDK arrives ---------- */
  if (root) {
    $$('[data-auth-tab]', root).forEach(function (btn) {
      on(btn, 'click', function () { showForm(btn.getAttribute('data-auth-tab')); });
    });

    $$('[data-auth-show]', root).forEach(function (el) {
      on(el, 'click', function (e) {
        e.preventDefault();
        showForm(el.getAttribute('data-auth-show'));
      });
    });
  }

  /* ---------- not connected yet ---------- */
  if (!configured) {
    if (!root) return;
    $$('input, button', root).forEach(function (el) {
      if (!el.hasAttribute('data-auth-tab') && !el.hasAttribute('data-auth-show')) el.disabled = true;
    });
    note('err',
      '<strong>Accounts are not connected yet.</strong><br>' +
      'The sign-in and sign-up forms are in place and will work as soon as the ' +
      'Supabase project URL and publishable key are added to <code>assets/js/auth.js</code>.');
    return;
  }

  /* ---------- load the SDK ---------- */
  function loadSdk() {
    return new Promise(function (resolve, reject) {
      if (window.supabase && window.supabase.createClient) return resolve();
      var s = document.createElement('script');
      s.src = SDK;
      s.onload = resolve;
      s.onerror = function () { reject(new Error('Could not load the Supabase library')); };
      document.head.appendChild(s);
    });
  }

  /* ---------- the account page ---------- */
  function renderSignedIn(user) {
    if (recovering) return showPanel('newpassword');
    showPanel('account');

    var meta = user.user_metadata || {};
    var name = $('[data-auth-name]', root);
    if (name) name.textContent = meta.full_name || 'Welcome back';

    $$('[data-auth-email]', root).forEach(function (el) {
      el.textContent = user.email || '';
    });

    var since = $('[data-auth-since]', root);
    if (since && user.created_at) {
      since.textContent = new Date(user.created_at).toLocaleDateString('en-GB', {
        day: 'numeric', month: 'long', year: 'numeric'
      });
    }
  }

  function renderSignedOut() {
    showPanel('forms');
  }

  function wireAccount() {
    /* A guest coming back from a confirmation or reset link arrives carrying
       credentials in the URL: tokens in the fragment on the implicit flow, or
       a ?code= on PKCE. Either way the SDK reads them while it initialises,
       and that is asynchronous — so the address bar is tidied only once a
       session exists. Stripping it any sooner would take the credentials away
       before the SDK had read them, and the guest would land signed out. */
    var arrivedWithCredentials =
      /(access_token|refresh_token)=/.test(window.location.hash) ||
      /[?&]code=/.test(window.location.search);

    function tidyUrl() {
      var search = window.location.search
        .replace(/([?&])code=[^&]*/, '$1')
        .replace(/[?&]$/, '');
      history.replaceState(null, '', window.location.pathname + search);
    }

    /* An expired or already-used link comes back as an error instead, in the
       fragment or the query depending on the flow. */
    function reportLinkError() {
      var src = window.location.hash + '&' + window.location.search;
      var m = /error_description=([^&]+)/.exec(src);
      if (!m) return;
      note('err', humanise(decodeURIComponent(m[1].replace(/\+/g, ' '))));
      tidyUrl();
    }

    client.auth.getSession().then(function (res) {
      var session = res && res.data && res.data.session;
      if (session && session.user) {
        renderSignedIn(session.user);
        if (arrivedWithCredentials) tidyUrl();
      } else {
        renderSignedOut();
        reportLinkError();
      }
    });

    client.auth.onAuthStateChange(function (event, session) {
      if (event === 'PASSWORD_RECOVERY') recovering = true;
      session && session.user ? renderSignedIn(session.user) : renderSignedOut();
    });

    /* ---------- sign in ---------- */
    on($('#signin-form', root), 'submit', function (e) {
      e.preventDefault();
      var form = e.target;
      var email = $('#si-email', form).value.trim();
      var password = $('#si-password', form).value;

      if (!email || !password) return note('err', 'Please enter your email address and password.');

      clearNotes();
      busy(form, true);

      client.auth.signInWithPassword({ email: email, password: password })
        .then(function (res) {
          busy(form, false);
          if (res.error) return note('err', humanise(res.error.message));
          /* onAuthStateChange swaps in the signed-in panel; clearing the form
             keeps the password out of the DOM behind it. */
          form.reset();
          clearNotes();
        })
        .catch(function (err) { busy(form, false); note('err', humanise(err.message)); });
    });

    /* ---------- create account ---------- */
    on($('#signup-form', root), 'submit', function (e) {
      e.preventDefault();
      var form = e.target;
      var name = $('#su-name', form).value.trim();
      var email = $('#su-email', form).value.trim();
      var password = $('#su-password', form).value;
      var confirm  = $('#su-confirm', form).value;

      if (!name) return note('err', 'Please tell us your name.');
      if (!email) return note('err', 'Please enter your email address.');
      if (password.length < 8) return note('err', 'Please choose a password of at least 8 characters.');
      if (password !== confirm) return note('err', 'Those two passwords do not match.');

      clearNotes();
      busy(form, true);

      client.auth.signUp({
        email: email,
        password: password,
        options: {
          data: { full_name: name },
          emailRedirectTo: window.location.origin + '/account'
        }
      })
        .then(function (res) {
          busy(form, false);
          if (res.error) return note('err', humanise(res.error.message));

          form.reset();

          /* Supabase returns a session when confirmation is switched off, and
             none when a guest still has to click a link. Both are a success;
             they just need different words. */
          if (res.data && res.data.session) return clearNotes();

          note('ok',
            '<strong>Account created.</strong><br>' +
            'Check your inbox for a confirmation link, then sign in.');
        })
        .catch(function (err) { busy(form, false); note('err', humanise(err.message)); });
    });

    /* ---------- ask for a reset link ---------- */
    on($('#reset-form', root), 'submit', function (e) {
      e.preventDefault();
      var form = e.target;
      var email = $('#rs-email', form).value.trim();
      if (!email) return note('err', 'Please enter your email address.');

      clearNotes();
      busy(form, true);

      client.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin + '/account'
      })
        .then(function (res) {
          busy(form, false);
          if (res.error) return note('err', humanise(res.error.message));
          form.reset();
          /* Deliberately the same words whether or not that address has an
             account. Saying "no account found" would let anyone test which of
             our guests' addresses are registered. */
          note('ok',
            '<strong>Check your inbox.</strong><br>' +
            'If that address has an account with us, a link to choose a new password is on its way.');
        })
        .catch(function (err) { busy(form, false); note('err', humanise(err.message)); });
    });

    /* ---------- choose a new password ---------- */
    on($('#newpass-form', root), 'submit', function (e) {
      e.preventDefault();
      var form = e.target;
      var password = $('#np-password', form).value;
      var confirm  = $('#np-confirm', form).value;

      if (password.length < 8) return note('err', 'Please choose a password of at least 8 characters.');
      if (password !== confirm) return note('err', 'Those two passwords do not match.');

      clearNotes();
      busy(form, true);

      client.auth.updateUser({ password: password })
        .then(function (res) {
          busy(form, false);
          if (res.error) return note('err', humanise(res.error.message));
          form.reset();
          recovering = false;
          if (res.data && res.data.user) renderSignedIn(res.data.user);
          note('ok', '<strong>Password changed.</strong> You are signed in.');
        })
        .catch(function (err) { busy(form, false); note('err', humanise(err.message)); });
    });

    /* ---------- sign out ---------- */
    on($('[data-auth-signout]', root), 'click', function (e) {
      var btn = e.currentTarget;
      btn.disabled = true;
      client.auth.signOut().then(function () {
        btn.disabled = false;
        recovering = false;
        clearNotes();
        renderSignedOut();
      });
    });
  }

  /* ---------- the reservations page ---------- */
  function wireBooking() {
    /* Only ever fills a box the guest has left alone. Anything they have
       already typed is theirs, including a different name or a friend's
       number, and must survive. */
    function fill(sel, value) {
      var el = $(sel);
      if (el && !el.value && value) el.value = value;
    }

    client.auth.getUser().then(function (res) {
      var user = res && res.data && res.data.user;
      if (!user) return;
      var meta = user.user_metadata || {};
      fill('#r-name',  meta.full_name);
      fill('#r-email', user.email);
      fill('#r-phone', meta.phone);
    });

    /* The phone number is not asked for at sign-up, so the first booking is
       where we learn it. Keeping it turns the second booking into a form that
       is already filled in, which is the whole of what the account promises.

       The values are read synchronously: the page clears the form shortly
       after submit, and this runs after the await. */
    on(booking, 'submit', function () {
      var typedName  = ($('#r-name')  || {}).value  || '';
      var typedPhone = ($('#r-phone') || {}).value || '';

      client.auth.getUser().then(function (res) {
        var user = res && res.data && res.data.user;
        if (!user) return;

        var meta = user.user_metadata || {};
        var patch = {};
        if (typedPhone.trim() && typedPhone.trim() !== meta.phone) patch.phone = typedPhone.trim();
        if (typedName.trim() && !meta.full_name) patch.full_name = typedName.trim();
        if (!Object.keys(patch).length) return;

        /* Merged rather than replaced, so remembering a phone number cannot
           quietly drop the name captured at sign-up. */
        Object.keys(meta).forEach(function (k) {
          if (!(k in patch)) patch[k] = meta[k];
        });
        client.auth.updateUser({ data: patch });
      });
    });
  }

  /* ---------- go ---------- */
  loadSdk().then(function () {
    client = window.supabase.createClient(SUPABASE.url, SUPABASE.anonKey);
    if (root) wireAccount();
    if (booking) wireBooking();
  }).catch(function (err) {
    if (root) note('err', 'Accounts are unavailable right now. ' + humanise(err.message));
  });
})();
