import { useCallback, useEffect, useState } from 'react';
import { apiRequest } from './api.js';
import './account.css';

const money = (value) => `₦${Number(value || 0).toLocaleString('en-NG')}`;
const dateTime = (value) => value ? new Intl.DateTimeFormat('en-NG', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : '';

export default function TrackOrder({ theme, toggleTheme }) {
  const initialId = new URLSearchParams(window.location.search).get('order') || '';
  const [orderId, setOrderId] = useState(initialId);
  const [trackingCode, setTrackingCode] = useState(() => {
    try {
      const recent = JSON.parse(window.sessionStorage.getItem('mikun-recent-order') || 'null');
      return recent?.id === initialId ? recent.token : '';
    } catch { return ''; }
  });
  const [order, setOrder] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [initialLookup] = useState(() => ({ id: initialId, token: trackingCode }));

  const loadOrder = useCallback(async (id, token) => {
    if (!id) return;
    setBusy(true); setError('');
    try {
      const data = await apiRequest(`/orders/${encodeURIComponent(id.trim())}`, {
        headers: token ? { 'X-Order-Token': token.trim() } : {},
      });
      setOrder(data.order);
      window.history.replaceState({}, '', `/track?order=${encodeURIComponent(id.trim())}`);
    } catch (requestError) {
      setOrder(null);
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (initialLookup.id) loadOrder(initialLookup.id, initialLookup.token);
  }, [initialLookup, loadOrder]);

  const steps = order?.fulfilment === 'delivery'
    ? ['Received', 'Confirmed', 'Preparing', 'Ready', 'Out for Delivery', 'Completed']
    : ['Received', 'Confirmed', 'Preparing', 'Ready', 'Completed'];
  const currentIndex = steps.indexOf(order?.status);

  return <div className="account-page">
    <header className="account-topbar">
      <a href="/" aria-label="Mikun home" className="account-logo"><img src="/mikun-logo.png" alt="MIKUN — Good Food, Good Vibe" /></a>
      <div className="account-top-actions"><a href="/">Back to restaurant <span aria-hidden="true">↗</span></a><button type="button" onClick={toggleTheme} aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}>{theme === 'dark' ? '☀' : '☾'}</button></div>
    </header>
    <main className="account-main">
      <div className="account-intro"><p className="account-eyebrow">MIKUN / ORDER TRACKING</p><h1>Your order,<br /><em>in motion.</em></h1><p>Enter your order ID and tracking code to see the latest status. If you ordered while signed in, your account can open the order directly.</p></div>
      <div className="track-grid">
        <section className="account-panel track-search">
          <h2>Find your order</h2>
          <form onSubmit={(event) => { event.preventDefault(); loadOrder(orderId, trackingCode); }}>
            <label>Order ID<input required value={orderId} onChange={(event) => setOrderId(event.target.value)} placeholder="The ID from your confirmation" /></label>
            <label>Tracking code <span>(for guest orders)</span><input value={trackingCode} onChange={(event) => setTrackingCode(event.target.value)} placeholder="The code from your confirmation" /></label>
            <button type="submit" disabled={busy}>{busy ? 'Checking…' : 'Check order'} <span aria-hidden="true">↗</span></button>
          </form>
          {error && <p className="account-error" role="alert">{error}</p>}
        </section>
        {order ? <section className="account-panel track-result" aria-live="polite">
          <div className="account-section-head"><div><span>ORDER #{order.id.slice(0, 8).toUpperCase()}</span><h2>{order.status}</h2></div><button type="button" className="account-refresh" onClick={() => loadOrder(order.id, trackingCode)}>Refresh</button></div>
          <p className="track-meta">{order.fulfilment === 'delivery' ? 'Delivery' : 'Pickup'} · Placed {dateTime(order.created_at)}</p>
          {currentIndex >= 0 ? <ol className="track-steps">{steps.map((step, index) => <li key={step} className={index <= currentIndex ? 'is-done' : ''}><span>{index < currentIndex ? '✓' : String(index + 1).padStart(2, '0')}</span><strong>{step}</strong></li>)}</ol> : <div className="track-special-status">The restaurant has marked this order {order.status.toLowerCase()}.</div>}
          <div className="track-order-lines"><h3>Order summary</h3>{(order.items || []).map((item) => <div key={item.id}><span>{item.quantity} × {item.name}</span><strong>{money(item.lineTotal)}</strong></div>)}<div className="track-total"><span>Total</span><strong>{money(order.total)}</strong></div></div>
          <p className="track-payment">Payment: {order.payment_status === 'paid' ? 'Paid' : 'Pay on ' + (order.fulfilment === 'delivery' ? 'delivery' : 'pickup')}</p>
        </section> : <aside className="track-aside"><span>GOOD FOOD<br />GOOD VIBE.</span><p>We will show progress here as the kitchen updates your order.</p></aside>}
      </div>
    </main>
    <footer className="account-footer"><span>MIKUN · GOOD FOOD, GOOD VIBE.</span><a href="/#menu">Explore the menu ↗</a></footer>
  </div>;
}
