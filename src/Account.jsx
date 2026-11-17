import { useCallback, useEffect, useState } from 'react';
import { apiRequest } from './api.js';
import './account.css';

const money = (value) => `₦${Number(value || 0).toLocaleString('en-NG')}`;
const dateTime = (value) => value ? new Intl.DateTimeFormat('en-NG', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : '';

export default function Account({ theme, toggleTheme }) {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState('login');
  const [tab, setTab] = useState('orders');
  const [form, setForm] = useState({ name: '', email: '', phone: '', password: '' });
  const [profile, setProfile] = useState({ name: '', phone: '' });
  const [orders, setOrders] = useState([]);
  const [reservations, setReservations] = useState([]);
  const [reviewOrderId, setReviewOrderId] = useState(null);
  const [reviewRating, setReviewRating] = useState(5);
  const [reviewBody, setReviewBody] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const loadRecords = useCallback(async () => {
    const [orderData, reservationData] = await Promise.all([
      apiRequest('/account/orders'),
      apiRequest('/account/reservations'),
    ]);
    setOrders(orderData.orders || []);
    setReservations(reservationData.reservations || []);
  }, []);

  useEffect(() => {
    let active = true;
    apiRequest('/auth/session').then(async (data) => {
      if (!active) return;
      setSession(data);
      if (data.user) {
        setProfile({ name: data.user.name || '', phone: data.user.phone || '' });
        try { await loadRecords(); } catch (recordError) { if (active) setError(recordError.message); }
      }
    }).catch((requestError) => {
      if (active) setError(requestError.message);
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [loadRecords]);

  async function submitAuth(event) {
    event.preventDefault();
    setError(''); setNotice(''); setBusy(true);
    try {
      const body = mode === 'register'
        ? { name: form.name.trim(), email: form.email.trim(), phone: form.phone.trim(), password: form.password }
        : { email: form.email.trim(), password: form.password };
      const next = await apiRequest(mode === 'register' ? '/auth/register' : '/auth/login', { method: 'POST', body });
      setSession(next);
      setProfile({ name: next.user.name || '', phone: next.user.phone || '' });
      setForm((current) => ({ ...current, password: '' }));
      await loadRecords();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  async function saveProfile(event) {
    event.preventDefault();
    setError(''); setNotice(''); setBusy(true);
    try {
      const data = await apiRequest('/account/profile', {
        method: 'PATCH',
        body: { name: profile.name.trim(), phone: profile.phone.trim() },
        headers: { 'X-CSRF-Token': session.csrfToken },
      });
      setSession((current) => ({ ...current, user: data.user }));
      setNotice('Your profile has been saved.');
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    setError(''); setNotice(''); setBusy(true);
    try {
      await apiRequest('/auth/logout', { method: 'POST', body: {}, headers: { 'X-CSRF-Token': session.csrfToken } });
      setSession({ user: null, csrfToken: null });
      setOrders([]);
      setReservations([]);
      setTab('orders');
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  async function submitReview(event) {
    event.preventDefault();
    setError(''); setNotice(''); setBusy(true);
    try {
      await apiRequest('/reviews', {
        method: 'POST',
        body: { orderId: reviewOrderId, rating: Number(reviewRating), body: reviewBody.trim() },
        headers: { 'X-CSRF-Token': session.csrfToken },
      });
      setReviewOrderId(null);
      setReviewBody('');
      setNotice('Thank you. Your review has been sent for moderation.');
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  return <div className="account-page">
    <header className="account-topbar">
      <a href="/" aria-label="Mikun home" className="account-logo"><img src="/mikun-logo.png" alt="MIKUN — Good Food, Good Vibe" /></a>
      <div className="account-top-actions">
        <a href="/">Back to restaurant <span aria-hidden="true">↗</span></a>
        <button type="button" onClick={toggleTheme} aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}>{theme === 'dark' ? '☀' : '☾'}</button>
      </div>
    </header>

    <main className="account-main">
      <div className="account-intro">
        <p className="account-eyebrow">THE MIKUN TABLE / YOUR SPACE</p>
        <h1>{session?.user ? <>Welcome back,<br /><em>{session.user.name.split(' ')[0]}.</em></> : <>Your food,<br /><em>your way.</em></>}</h1>
        <p>{session?.user ? 'Follow your orders, check upcoming visits, and keep your details current.' : 'Sign in to keep your orders and reservations together.'}</p>
      </div>

      {loading ? <div className="account-panel account-loading" role="status">Loading your account…</div> : session?.user ? (
        <div className="account-workspace">
          <div className="account-nav" role="tablist" aria-label="Account sections">
            {['orders', 'reservations', 'profile'].map((section) => <button key={section} type="button" role="tab" aria-selected={tab === section} className={tab === section ? 'is-active' : ''} onClick={() => { setTab(section); setError(''); setNotice(''); }}>{section}</button>)}
            <button type="button" onClick={logout} disabled={busy} className="account-signout">Sign out</button>
          </div>
          <section className="account-panel">
            {tab === 'orders' && <>
              <div className="account-section-head"><div><span>01 / ORDER HISTORY</span><h2>Every good meal.</h2></div><button type="button" className="account-refresh" onClick={() => loadRecords().catch((requestError) => setError(requestError.message))}>Refresh</button></div>
              {orders.length ? <div className="account-record-list">{orders.map((order) => <article key={order.id} className="account-record"><div><span className="account-record-id">#{order.id.slice(0, 8).toUpperCase()}</span><h3>{order.fulfilment === 'delivery' ? 'Delivery order' : 'Pickup order'}</h3><p>{dateTime(order.created_at)}</p>{order.status === 'Completed' && <button type="button" className="account-review-trigger" onClick={() => { setReviewOrderId(order.id); setReviewRating(5); setReviewBody(''); setError(''); }}>Write a review</button>}</div><div className="account-record-end"><strong>{money(order.total)}</strong><span className="account-status">{order.status}</span></div>{reviewOrderId === order.id && <form className="account-review-form" onSubmit={submitReview}><label>Rating<select value={reviewRating} onChange={(event) => setReviewRating(Number(event.target.value))}>{[5, 4, 3, 2, 1].map((rating) => <option key={rating} value={rating}>{rating} stars</option>)}</select></label><label>Your review<textarea required minLength="10" maxLength="1500" rows="4" value={reviewBody} onChange={(event) => setReviewBody(event.target.value)} placeholder="Tell us about your meal" /></label><div><button type="button" onClick={() => setReviewOrderId(null)}>Cancel</button><button type="submit" disabled={busy}>Send review</button></div></form>}</article>)}</div> : <div className="account-empty"><h3>No orders yet.</h3><p>Your first order will appear here after checkout while signed in.</p><a href="/#menu">Explore the menu ↗</a></div>}
            </>}
            {tab === 'reservations' && <>
              <div className="account-section-head"><div><span>02 / YOUR VISITS</span><h2>Meet at Mikun.</h2></div><button type="button" className="account-refresh" onClick={() => loadRecords().catch((requestError) => setError(requestError.message))}>Refresh</button></div>
              {reservations.length ? <div className="account-record-list">{reservations.map((reservation) => <article key={reservation.id} className="account-record"><div><span className="account-record-id">#{reservation.id.slice(0, 8).toUpperCase()}</span><h3>{reservation.reservation_date} · {reservation.reservation_time}</h3><p>Table for {reservation.party_size}{reservation.table_label ? ` · ${reservation.table_label}` : ''}</p></div><span className="account-status">{reservation.status}</span></article>)}</div> : <div className="account-empty"><h3>No reservations yet.</h3><p>Bookings will appear here when the restaurant opens reservations.</p><a href="/#reservations">Reservations ↗</a></div>}
            </>}
            {tab === 'profile' && <>
              <div className="account-section-head"><div><span>03 / YOUR DETAILS</span><h2>Make it yours.</h2></div></div>
              <form className="account-profile-form" onSubmit={saveProfile}>
                <label>Full name<input required minLength="2" maxLength="80" value={profile.name} onChange={(event) => setProfile({ ...profile, name: event.target.value })} /></label>
                <label>Email address<input type="email" value={session.user.email} readOnly /><small>Contact the restaurant if your account email needs to change.</small></label>
                <label>Phone number<input type="tel" maxLength="30" value={profile.phone} onChange={(event) => setProfile({ ...profile, phone: event.target.value })} /></label>
                <button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save profile'} <span aria-hidden="true">↗</span></button>
              </form>
            </>}
            {error && <p className="account-error" role="alert">{error}</p>}
            {notice && <p className="account-notice" role="status">{notice}</p>}
          </section>
        </div>
      ) : (
        <section className="account-panel account-auth">
          <div className="account-auth-tabs" role="tablist" aria-label="Account access"><button type="button" role="tab" aria-selected={mode === 'login'} className={mode === 'login' ? 'is-active' : ''} onClick={() => { setMode('login'); setError(''); }}>Sign in</button><button type="button" role="tab" aria-selected={mode === 'register'} className={mode === 'register' ? 'is-active' : ''} onClick={() => { setMode('register'); setError(''); }}>Create account</button></div>
          <h2>{mode === 'login' ? 'Good to see you again.' : 'Join the table.'}</h2>
          <form onSubmit={submitAuth}>
            {mode === 'register' && <label>Full name<input autoComplete="name" required minLength="2" maxLength="80" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>}
            <label>Email address<input type="email" autoComplete="email" required value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></label>
            {mode === 'register' && <label>Phone number <span>(optional)</span><input type="tel" autoComplete="tel" maxLength="30" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} /></label>}
            <label>Password<input type="password" autoComplete={mode === 'register' ? 'new-password' : 'current-password'} required minLength={mode === 'register' ? 12 : 1} maxLength="128" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} /><small>{mode === 'register' ? 'Use at least 12 characters.' : ''}</small></label>
            {error && <p className="account-error" role="alert">{error}</p>}
            <button type="submit" disabled={busy}>{busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'} <span aria-hidden="true">↗</span></button>
          </form>
        </section>
      )}
    </main>
    <footer className="account-footer"><span>MIKUN · GOOD FOOD, GOOD VIBE.</span><a href="/">Return to the restaurant ↗</a></footer>
  </div>;
}
