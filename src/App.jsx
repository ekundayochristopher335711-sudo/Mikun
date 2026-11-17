import { useCallback, useEffect, useState } from 'react';
import Admin from './Admin.jsx';
import Account from './Account.jsx';
import PublicSite from './PublicSite.jsx';
import TrackOrder from './TrackOrder.jsx';
import { apiRequest } from './api.js';

const THEME_KEY = 'mikun-theme-v2';

function initialTheme() {
  try {
    return window.localStorage.getItem(THEME_KEY) === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

export default function App() {
  const [theme, setTheme] = useState(initialTheme);
  const [menu, setMenu] = useState([]);
  const [settings, setSettings] = useState({});
  const [content, setContent] = useState({});
  const [reviews, setReviews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const isAdmin = window.location.pathname.replace(/\/+$/, '') === '/admin';
  const isAccount = window.location.pathname.replace(/\/+$/, '') === '/account';
  const isTracking = window.location.pathname.replace(/\/+$/, '') === '/track';

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#101412' : '#ffffff');
    try { window.localStorage.setItem(THEME_KEY, theme); } catch { /* Storage can be unavailable. */ }
  }, [theme]);

  const toggleTheme = useCallback(() => setTheme((current) => current === 'dark' ? 'light' : 'dark'), []);

  const refreshPublic = useCallback(async () => {
    try {
      const [menuData, siteData, reviewData] = await Promise.all([
        apiRequest('/public/menu'),
        apiRequest('/public/settings'),
        apiRequest('/public/reviews'),
      ]);
      setMenu(menuData.items || []);
      setSettings(siteData.settings || {});
      setContent(siteData.content || {});
      setReviews((reviewData.reviews || []).map((entry) => ({
        id: entry.id,
        name: entry.customerName,
        rating: entry.rating,
        comment: entry.body,
        createdAt: entry.createdAt,
      })));
      setLoadError('');
    } catch (error) {
      setLoadError(error.message || 'The menu could not be loaded. Please try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isAdmin || isAccount || isTracking) return undefined;
    refreshPublic();
    const onFocus = () => { refreshPublic(); };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [isAdmin, isAccount, isTracking, refreshPublic]);

  const submitOrder = useCallback(async (draft) => {
    const fulfilment = draft.fulfillment === 'delivery' ? 'delivery' : 'pickup';
    const result = await apiRequest('/orders', {
      method: 'POST',
      body: {
        customerName: draft.customerName,
        phone: draft.phone,
        email: draft.email || '',
        fulfilment,
        deliveryAddress: fulfilment === 'delivery' ? (draft.address || '') : '',
        instructions: draft.notes || '',
        paymentMethod: fulfilment === 'delivery' ? 'pay_on_delivery' : 'pay_on_pickup',
        promotionCode: draft.promotionCode || '',
        items: (draft.items || []).map((item) => ({ menuItemId: item.id, quantity: item.quantity, options: item.options || [] })),
      },
    });
    try {
      if (result.order?.id && result.trackingToken) {
        window.sessionStorage.setItem('mikun-recent-order', JSON.stringify({ id: result.order.id, token: result.trackingToken }));
      }
    } catch { /* Tracking code remains visible in the confirmation. */ }
    await refreshPublic();
    return result;
  }, [refreshPublic]);

  const submitReservation = useCallback(async (draft) => apiRequest('/reservations', {
    method: 'POST',
    body: {
      customerName: draft.name,
      phone: draft.phone,
      email: draft.email,
      date: draft.date,
      time: draft.time,
      partySize: Number(draft.guests),
      requests: draft.notes || '',
    },
  }), []);

  if (isAdmin) return <Admin theme={theme} toggleTheme={toggleTheme} />;
  if (isAccount) return <Account theme={theme} toggleTheme={toggleTheme} />;
  if (isTracking) return <TrackOrder theme={theme} toggleTheme={toggleTheme} />;

  return <PublicSite
    menu={menu}
    settings={settings}
    content={content}
    reviews={reviews}
    loading={loading}
    loadError={loadError}
    theme={theme}
    toggleTheme={toggleTheme}
    onSubmitOrder={submitOrder}
    onSubmitReservation={submitReservation}
    onRetryLoad={refreshPublic}
  />;
}
