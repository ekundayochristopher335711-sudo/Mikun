import { useEffect, useMemo, useRef, useState } from 'react';
import { formatPrice } from './data.js';

const photoSet = [
  { src: '/photos/jollof-hero.jpg', alt: 'Jollof rice topped with chicken skewers', title: 'A colourful plate' },
  { src: '/photos/nigerian-table.jpg', alt: 'Nigerian rice, chicken and sides on a dining table', title: 'Made to share' },
  { src: '/photos/jollof-fish.jpg', alt: 'Jollof rice, chicken skewers and grilled fish', title: 'Flavour together' },
  { src: '/photos/jollof-closeup.jpg', alt: 'A close-up of a plated rice dish', title: 'Savour every bite' },
];

function Icon({ name, size = 20 }) {
  const p = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true };
  if (name === 'arrow') return <svg {...p}><path d="M5 12h14m-6-6 6 6-6 6" /></svg>;
  if (name === 'up') return <svg {...p}><path d="M7 17 17 7M8 7h9v9" /></svg>;
  if (name === 'bag') return <svg {...p}><path d="M4.5 8.5h15l-1 12h-13l-1-12Z" /><path d="M9 9V6a3 3 0 0 1 6 0v3" /></svg>;
  if (name === 'check') return <svg {...p}><path d="m4.5 12.5 5 5 10-11" /></svg>;
  if (name === 'close') return <svg {...p}><path d="M5 5 19 19M19 5 5 19" /></svg>;
  if (name === 'heart') return <svg {...p}><path d="M20.8 8.6c0 4.3-8.8 10.4-8.8 10.4S3.2 12.9 3.2 8.6a4.6 4.6 0 0 1 8.8-1.8 4.6 4.6 0 0 1 8.8 1.8Z" /></svg>;
  if (name === 'menu') return <svg {...p}><path d="M4 6h16M4 12h16M4 18h16" /></svg>;
  if (name === 'minus') return <svg {...p}><path d="M5 12h14" /></svg>;
  if (name === 'moon') return <svg {...p}><path d="M20.2 15.4A8.7 8.7 0 0 1 8.6 3.8a8.7 8.7 0 1 0 11.6 11.6Z" /></svg>;
  if (name === 'plus') return <svg {...p}><path d="M12 5v14M5 12h14" /></svg>;
  if (name === 'search') return <svg {...p}><circle cx="10.7" cy="10.7" r="6.7" /><path d="m16 16 5 5" /></svg>;
  if (name === 'sun') return <svg {...p}><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M2 12h2m16 0h2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4" /></svg>;
  return null;
}

function useStoredValue(key, fallback) {
  const [value, setValue] = useState(() => {
    try { const saved = localStorage.getItem(key); return saved ? JSON.parse(saved) : fallback; }
    catch { return fallback; }
  });
  useEffect(() => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage may be disabled */ } }, [key, value]);
  return [value, setValue];
}

function itemOptionDetails(item, selections = []) {
  return selections.map(({ groupId, choiceId }) => {
    const group = item.options?.find((entry) => entry.id === groupId);
    const choice = group?.choices?.find((entry) => entry.id === choiceId);
    return choice ? { label: `${group.name}: ${choice.name}`, priceDelta: Number(choice.priceDelta || 0) } : null;
  }).filter(Boolean);
}

function ItemOptionsDialog({ item, onClose, onAdd, currency }) {
  const [selected, setSelected] = useState({});
  const groups = item.options || [];
  const selections = groups.filter((group) => selected[group.id]).map((group) => ({ groupId: group.id, choiceId: selected[group.id] }));
  const valid = groups.every((group) => !group.required || selected[group.id]);
  const delta = itemOptionDetails(item, selections).reduce((sum, entry) => sum + entry.priceDelta, 0);
  useEffect(() => {
    const onKey = (event) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey); document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = ''; };
  }, [onClose]);
  return <div className="m-options-layer"><button className="m-options-backdrop" type="button" onClick={onClose} aria-label="Close item details" /><div className="m-options-dialog" role="dialog" aria-modal="true" aria-label={`Choose options for ${item.name}`}><div className="m-options-top"><span>CUSTOMISE YOUR ORDER</span><button type="button" onClick={onClose} aria-label="Close item details"><Icon name="close" size={22} /></button></div>{item.imageUrl && <img className="m-options-image" src={item.imageUrl} alt={item.name} />}<h2>{item.name}</h2>{item.description && <p>{item.description}</p>}{groups.map((group) => <fieldset key={group.id}><legend>{group.name} {group.required && <span>Required</span>}</legend>{group.choices?.map((choice) => <label key={choice.id}><input type="radio" name={group.id} checked={selected[group.id] === choice.id} onChange={() => setSelected((current) => ({ ...current, [group.id]: choice.id }))} /><span>{choice.name}</span><strong>{Number(choice.priceDelta || 0) > 0 ? `+${formatPrice(choice.priceDelta, currency || '₦')}` : 'Included'}</strong></label>)}</fieldset>)}<button className="m-button m-button-green m-options-submit" type="button" disabled={!valid} onClick={() => onAdd(item, selections)}>Add to basket <span>{formatPrice(Number(item.price) + delta, currency || '₦')}</span></button></div></div>;
}

function Header({ count, openCart, theme, toggleTheme }) {
  const [open, setOpen] = useState(false);
  const links = [['Home', '#home'], ['Our Menu', '#menu'], ['About Us', '#about'], ['Gallery', '#gallery'], ['Reservations', '#reservations'], ['Contact', '#contact'], ['Account', '/account']];
  return <header className="m-header"><div className="m-wrap m-header-inner">
    <a className="m-brand" href="#home" onClick={() => setOpen(false)} aria-label="MIKUN home"><img src="/mikun-logo.png" alt="MIKUN — Good Food, Good Vibe" /></a>
    <nav className={open ? 'm-nav is-open' : 'm-nav'} aria-label="Main navigation">{links.map(([label, href]) => <a key={href} href={href} onClick={() => setOpen(false)}>{label}</a>)}</nav>
    <div className="m-header-actions">
      <button type="button" className="m-icon-button" onClick={toggleTheme} aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`} title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}><Icon name={theme === 'dark' ? 'sun' : 'moon'} /></button>
      <button type="button" className="m-icon-button m-header-bag" onClick={openCart} aria-label={`Open basket, ${count} items`}><Icon name="bag" size={21} />{count > 0 && <span>{count}</span>}</button>
      <a className="m-header-order" href="#menu">Order now <Icon name="up" size={16} /></a>
      <button type="button" className="m-icon-button m-mobile-toggle" aria-label={open ? 'Close menu' : 'Open menu'} aria-expanded={open} onClick={() => setOpen((value) => !value)}><Icon name={open ? 'close' : 'menu'} size={23} /></button>
    </div>
  </div></header>;
}

function Hero({ settings, content }) {
  const tagline = content?.heroHeadline || settings.tagline || 'Good food. Good vibe.';
  const standard = /^good food[., ]+good vibe[.! ]*$/i.test(tagline.trim());
  return <section className="m-hero m-kandy-hero" id="home" aria-labelledby="m-hero-heading"><div className="m-wrap m-hero-grid">
    <div className="m-hero-copy"><div className="m-eyebrow"><span />WELCOME TO MIKUN <small>01 / THE EXPERIENCE</small></div><h1 id="m-hero-heading">{standard ? <>Good food.<br /><em>Good vibe.</em></> : tagline}</h1><p>{content?.heroDescription || 'Comforting favourites, colourful plates and moments worth sharing. Find your next good food mood at MIKUN.'}</p><div className="m-hero-actions"><a className="m-button m-button-green" href="#menu">Explore our menu <Icon name="arrow" size={19} /></a><a className="m-text-link" href="#reservations">Book a table <Icon name="up" size={18} /></a></div><div className="m-hero-foot"><b /> Dishes <span>•</span> Proteins <span>•</span> Drinks</div></div>
    <div className="m-hero-media"><div className="m-hero-image"><img src="/photos/jollof-hero.jpg" alt="Illustrative photograph of jollof rice and chicken skewers" fetchPriority="high" /></div><div className="m-hero-stamp" aria-hidden="true"><span>GOOD FOOD</span><strong>✳</strong><span>GOOD VIBE</span></div><div className="m-hero-caption"><span>01 / FOOD & FEELING</span><span>Illustrative food photography</span></div></div>
  </div></section>;
}

function FoodStory() {
  const cards = [
    { title: 'Rice plates', image: '/photos/jollof-closeup.jpg', alt: 'Illustrative close-up photograph of a plated rice dish', search: 'jollof' },
    { title: 'Comfort classics', image: '/photos/nigerian-table.jpg', alt: 'Illustrative photograph of a Nigerian dining table', search: 'semo' },
    { title: 'Something extra', image: '/photos/jollof-fish.jpg', alt: 'Illustrative photograph of rice, chicken and fish', search: 'fish' },
  ];
  return <section className="m-food-story m-section" aria-labelledby="m-food-story-heading"><div className="m-wrap"><div className="m-section-heading"><div><span className="m-kicker">A TASTE OF THE MENU <i>✳</i></span><h2 id="m-food-story-heading">Food for <em>every mood.</em></h2></div><p>Explore the favourites that make a meal feel complete, from rice plates to the extras you love.</p></div><div className="m-food-grid">{cards.map((card, index) => <article className="m-food-card" key={card.title}><a href="#menu" aria-label={`Explore ${card.title} on the menu`}><img src={card.image} alt={card.alt} loading="lazy" /></a><div className="m-food-meta"><span>{String(index + 1).padStart(2, '0')} / EDITORIAL FOOD PHOTOGRAPHY</span><span>ILLUSTRATIVE</span></div><div className="m-food-card-bottom"><h3>{card.title}</h3><a className="m-food-card-arrow" href="#menu" aria-label={`Explore ${card.title} on the menu`}><Icon name="up" size={18} /></a></div></article>)}</div></div></section>;
}

function MenuSection({ menu, settings, onAdd, favorites, setFavorites, loading, loadError }) {
  const [category, setCategory] = useState('All');
  const [query, setQuery] = useState('');
  const categories = useMemo(() => ['All', ...new Set(menu.map((item) => item.category).filter(Boolean))], [menu]);
  const visible = useMemo(() => menu.filter((item) => (category === 'All' || item.category === category) && `${item.name} ${item.description || ''}`.toLowerCase().includes(query.trim().toLowerCase())), [menu, category, query]);
  const toggleFavorite = (id) => setFavorites((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
  return <section className="m-menu-section m-section" id="menu" aria-labelledby="m-menu-heading"><div className="m-wrap"><div className="m-section-heading"><div><span className="m-kicker">EXPLORE THE FLAVOURS <i>✳</i></span><h2 id="m-menu-heading">Our <em>menu.</em></h2></div><p>Pick your favourites and build a plate that feels just right.</p></div>
    <div className="m-menu-controls"><div className="m-menu-tabs" role="group" aria-label="Menu category">{categories.map((item) => <button type="button" key={item} className={category === item ? 'is-active' : ''} onClick={() => setCategory(item)} aria-pressed={category === item}>{item}</button>)}</div><label className="m-menu-search"><Icon name="search" size={19} /><span className="m-sr-only">Search menu</span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find a dish..." /></label></div>
    <div className="m-menu-list" aria-live="polite">{loading ? <p className="m-menu-message">Loading the menu…</p> : loadError ? <div className="m-menu-message"><strong>Menu unavailable</strong><p>{loadError}</p><span>Please try again shortly.</span></div> : visible.length ? visible.map((item) => <article className={item.available === false ? 'm-menu-item is-unavailable' : 'm-menu-item'} key={item.id}><span className="m-menu-number">{String(menu.indexOf(item) + 1).padStart(2, '0')}</span><div className="m-menu-copy">{item.imageUrl && <img className="m-menu-thumb" src={item.imageUrl} alt={item.name} loading="lazy" />}<h3>{item.name}</h3>{item.description && <p>{item.description}</p>}{item.available === false && <small>Currently unavailable</small>}</div><div className="m-menu-actions"><strong>{formatPrice(item.price, settings.currency || '₦')}</strong><button type="button" className={favorites.includes(item.id) ? 'm-favorite is-active' : 'm-favorite'} onClick={() => toggleFavorite(item.id)} aria-label={`${favorites.includes(item.id) ? 'Remove' : 'Save'} ${item.name} ${favorites.includes(item.id) ? 'from' : 'to'} favourites`} aria-pressed={favorites.includes(item.id)}><Icon name="heart" size={18} /></button><button type="button" className="m-add" onClick={() => onAdd(item)} disabled={item.available === false || settings.acceptingOrders === false} aria-label={`Add ${item.name} to basket`}><Icon name="plus" size={18} /></button></div></article>) : <div className="m-menu-message"><strong>No dishes found.</strong><p>Try another search or category.</p><button type="button" onClick={() => { setQuery(''); setCategory('All'); }}>Show all items</button></div>}</div><div className="m-menu-foot"><span>{visible.length} ITEMS TO EXPLORE</span><span>Verified MIKUN dish photos can be added by the team.</span></div>
  </div></section>;
}

function About({ settings, content }) {
  return <section className="m-about m-section" id="about" aria-labelledby="m-about-heading"><div className="m-wrap m-about-grid"><div className="m-about-photo"><img src="/photos/nigerian-table.jpg" alt="Illustrative photograph of a Nigerian meal at a table" loading="lazy" /><span>GOOD FOOD, GOOD VIBE</span></div><div className="m-about-copy"><span className="m-kicker">A LITTLE ABOUT US <i>✳</i></span><h2 id="m-about-heading">{content?.aboutHeadline || <>More than a meal.<br /><em>A moment.</em></>}</h2><p>{content?.aboutText || 'MIKUN brings comforting favourites and an easygoing spirit together. From semo and eba to jollof, proteins and a cold drink, the menu gives everyone something to look forward to.'}</p><p>However you join us, the idea is simple: eat well, feel welcome, and leave with a good vibe.</p><div className="m-about-sign"><strong>MIKUN</strong><span>{settings.tagline || 'Good food. Good vibe.'}</span></div></div></div></section>;
}

function Gallery() {
  const [selected, setSelected] = useState(null);
  useEffect(() => {
    if (selected === null) return undefined;
    const onKey = (event) => { if (event.key === 'Escape') setSelected(null); if (event.key === 'ArrowRight') setSelected((selected + 1) % photoSet.length); if (event.key === 'ArrowLeft') setSelected((selected + photoSet.length - 1) % photoSet.length); };
    document.addEventListener('keydown', onKey); document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = ''; };
  }, [selected]);
  return <section className="m-gallery m-section" id="gallery" aria-labelledby="m-gallery-heading"><div className="m-wrap"><div className="m-section-heading"><div><span className="m-kicker">THE FOOD MOOD <i>✳</i></span><h2 id="m-gallery-heading">A feast for <em>the eyes.</em></h2></div><p>Real editorial photographs of food that inspire this preview. These are not photographs of MIKUN dishes or premises.</p></div><div className="m-gallery-grid">{photoSet.map((photo, index) => <button type="button" className={`m-gallery-tile m-gallery-${index + 1}`} onClick={() => setSelected(index)} key={photo.src} aria-label={`View ${photo.title}`}><img src={photo.src} alt={photo.alt} loading="lazy" /><span>{photo.title}<Icon name="up" size={17} /></span></button>)}</div></div>
    {selected !== null && <div className="m-lightbox" role="dialog" aria-modal="true" aria-label={photoSet[selected].title}><button type="button" className="m-lightbox-backdrop" onClick={() => setSelected(null)} aria-label="Close photo" /><div className="m-lightbox-content"><button type="button" className="m-lightbox-close" onClick={() => setSelected(null)} aria-label="Close photo"><Icon name="close" size={23} /></button><img src={photoSet[selected].src} alt={photoSet[selected].alt} /><div className="m-lightbox-caption"><span>{photoSet[selected].title}</span><small>Illustrative food photography · {selected + 1} / {photoSet.length}</small></div><div className="m-lightbox-actions"><button type="button" onClick={() => setSelected((selected + photoSet.length - 1) % photoSet.length)}>← Previous</button><button type="button" onClick={() => setSelected((selected + 1) % photoSet.length)}>Next →</button></div></div></div>}
  </section>;
}

function Reservation({ settings, onSubmitReservation }) {
  const [form, setForm] = useState({ name: '', phone: '', email: '', date: '', time: '', guests: '2', notes: '' });
  const [status, setStatus] = useState({ kind: '', message: '' });
  const [working, setWorking] = useState(false);
  const today = new Date().toLocaleDateString('en-CA');
  const change = (event) => setForm((current) => ({ ...current, [event.target.name]: event.target.value }));
  async function submit(event) {
    event.preventDefault();
    if (!settings.reservationsEnabled || !onSubmitReservation) return;
    setWorking(true); setStatus({ kind: '', message: '' });
    try {
      const result = await onSubmitReservation({ ...form, guests: Number(form.guests) });
      const reference = result?.reservation?.reference || result?.reference;
      setStatus({ kind: 'success', message: `Your reservation request is saved${reference ? ` — ${reference}` : ''}. Please keep your reference for follow-up.` });
      setForm({ name: '', phone: '', email: '', date: '', time: '', guests: '2', notes: '' });
    } catch (error) { setStatus({ kind: 'error', message: error?.message || 'The reservation could not be saved. Please try again.' }); }
    finally { setWorking(false); }
  }
  return <section className="m-reservations m-section" id="reservations" aria-labelledby="m-reservation-heading"><div className="m-wrap m-reservation-grid"><div className="m-reservation-copy"><span className="m-kicker">MAKE IT A DATE <i>✳</i></span><h2 id="m-reservation-heading">Pull up <em>a chair.</em></h2><p>Good food tastes even better together. Share the details below and let us make space for your next good food moment.</p><div className="m-reservation-aside"><span>✳</span><p>For special occasions or larger groups, tell us a little more in the notes.</p></div></div><form className="m-reservation-form" onSubmit={submit}><div className="m-form-top"><span>01 / BOOK A TABLE</span><span>YOUR MOMENT STARTS HERE</span></div>{!settings.reservationsEnabled && <p className="m-form-banner">Online reservations are currently paused. Please check back after the restaurant opens booking slots.</p>}<div className="m-form-grid"><label>Your name<input required name="name" value={form.name} onChange={change} maxLength={80} autoComplete="name" placeholder="How should we address you?" /></label><label>Phone number<input required name="phone" type="tel" value={form.phone} onChange={change} maxLength={30} autoComplete="tel" placeholder="Your contact number" /></label><label>Email address<input required name="email" type="email" value={form.email} onChange={change} maxLength={120} autoComplete="email" placeholder="you@example.com" /></label><label>Guests<select name="guests" value={form.guests} onChange={change}>{Array.from({ length: 12 }, (_, index) => <option value={index + 1} key={index + 1}>{index + 1} {index ? 'guests' : 'guest'}</option>)}</select></label><label>Date<input required name="date" type="date" min={today} value={form.date} onChange={change} /></label><label>Time<input required name="time" type="time" value={form.time} onChange={change} /></label><label className="m-form-wide">Special request <span>(optional)</span><textarea name="notes" rows="2" maxLength={500} value={form.notes} onChange={change} placeholder="Anything we should know?" /></label></div>{status.message && <p className={`m-form-status is-${status.kind}`} role="status">{status.message}</p>}<button className="m-button m-button-green m-form-submit" type="submit" disabled={!settings.reservationsEnabled || !onSubmitReservation || working}>{working ? 'Sending request…' : 'Request a table'} <Icon name="arrow" size={19} /></button></form></div></section>;
}

function Reviews({ reviews = [] }) {
  const approved = reviews.slice(0, 3);
  return <section className="m-reviews m-section" aria-labelledby="m-reviews-heading"><div className="m-wrap m-reviews-grid"><div><span className="m-kicker">THE GOOD WORD <i>✳</i></span><h2 id="m-reviews-heading">The people <em>have spoken.</em></h2><p>Real guest reviews appear here once they have been verified and approved.</p></div><div className="m-review-list">{approved.length ? approved.map((review) => <blockquote key={review.id}><span aria-label={`${review.rating} out of 5 stars`}>{'★'.repeat(Math.max(1, Math.min(5, Number(review.rating))))}</span><p>“{review.comment}”</p><footer>— {review.name}</footer></blockquote>) : <div className="m-review-empty"><span>✳</span><p>Guest stories are coming soon.</p><small>Verified reviews will be published here.</small></div>}</div></div></section>;
}

function Contact({ settings }) {
  const instagram = settings.instagram ? (settings.instagram.startsWith('http') ? settings.instagram : `https://instagram.com/${settings.instagram.replace(/^@/, '')}`) : '';
  return <section className="m-contact m-section" id="contact" aria-labelledby="m-contact-heading"><div className="m-wrap m-contact-grid"><div><span className="m-kicker">COME SAY HELLO <i>✳</i></span><h2 id="m-contact-heading">See you <em>soon.</em></h2><p>Whether it is a quick bite or a shared meal, there is always room for a good food moment.</p><a className="m-button m-button-dark" href="#menu">Explore the menu <Icon name="arrow" size={19} /></a></div><div className="m-contact-details"><div><span>FIND US</span>{settings.address ? <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(settings.address)}`} target="_blank" rel="noreferrer">{settings.address} ↗</a> : <p>Location details coming soon</p>}</div><div><span>OPENING HOURS</span><p>{settings.hours || 'Hours will be announced here'}</p></div><div><span>GET IN TOUCH</span>{settings.phone ? <a href={`tel:${settings.phone.replace(/[^+\d]/g, '')}`}>{settings.phone}</a> : <p>Contact details coming soon</p>}{instagram && <a href={instagram} target="_blank" rel="noreferrer">Instagram ↗</a>}</div></div></div></section>;
}

function Footer({ settings, theme, toggleTheme }) {
  return <footer className="m-footer"><div className="m-wrap"><div className="m-footer-main"><div><a className="m-footer-logo" href="#home"><img src="/mikun-logo.png" alt="MIKUN — Good Food, Good Vibe" /></a><p>Good food brings us together.<br />Good vibes keep us here.</p></div><div className="m-footer-links"><div><strong>EXPLORE</strong><a href="#home">Home</a><a href="#menu">Our Menu</a><a href="#about">About Us</a><a href="#gallery">Gallery</a></div><div><strong>CONNECT</strong><a href="#reservations">Reservations</a><a href="#contact">Contact</a><a href="/track">Track order</a><a href="/account">Account</a><a href="/admin">Admin</a><button type="button" onClick={toggleTheme}>{theme === 'dark' ? 'Light mode' : 'Dark mode'}</button></div></div></div><div className="m-footer-bottom"><span>© {new Date().getFullYear()} {settings.businessName || 'MIKUN'}. All rights reserved.</span><span>Food photos are illustrative stock imagery, not MIKUN dishes.</span><a href="#home">Back to top ↑</a></div></div></footer>;
}

function CartDrawer({ open, onClose, cart, setCart, menu, settings, onSubmitOrder, setOrders }) {
  const drawerRef = useRef(null);
  const [step, setStep] = useState('basket');
  const [form, setForm] = useState({ customerName: '', phone: '', fulfillment: 'pickup', address: '', notes: '' });
  const [message, setMessage] = useState('');
  const [reference, setReference] = useState('');
  const [trackingToken, setTrackingToken] = useState('');
  const [trackingOrderId, setTrackingOrderId] = useState('');
  const [working, setWorking] = useState(false);
  const lines = cart.map((line) => ({ ...line, item: menu.find((item) => item.id === line.id) })).filter((line) => line.item && line.item.available !== false && line.quantity > 0);
  const subtotal = lines.reduce((sum, line) => sum + (Number(line.item.price) + itemOptionDetails(line.item, line.options).reduce((extra, option) => extra + option.priceDelta, 0)) * line.quantity, 0);
  const deliveryFee = form.fulfillment === 'delivery' ? Number(settings.deliveryFee || 0) : 0;
  useEffect(() => {
    if (!open) return undefined;
    const previous = document.activeElement;
    const onKey = (event) => {
      if (event.key === 'Escape') onClose();
      if (event.key !== 'Tab' || !drawerRef.current) return;
      const focusable = [...drawerRef.current.querySelectorAll('button:not(:disabled), a[href], input:not(:disabled), textarea:not(:disabled), select:not(:disabled)')];
      if (!focusable.length) return;
      if (event.shiftKey && document.activeElement === focusable[0]) { event.preventDefault(); focusable.at(-1).focus(); }
      if (!event.shiftKey && document.activeElement === focusable.at(-1)) { event.preventDefault(); focusable[0].focus(); }
    };
    document.addEventListener('keydown', onKey); document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = ''; previous?.focus?.(); };
  }, [open, onClose]);
  const adjust = (key, delta) => setCart((current) => current.map((line) => (line.key || line.id) === key ? { ...line, quantity: line.quantity + delta } : line).filter((line) => line.quantity > 0));
  const change = (event) => setForm((current) => ({ ...current, [event.target.name]: event.target.value }));
  const close = () => { onClose(); if (step === 'success') { setStep('basket'); setReference(''); setTrackingToken(''); setTrackingOrderId(''); } };
  async function submit(event) {
    event.preventDefault();
    if (!lines.length || !form.customerName.trim() || !form.phone.trim()) return;
    setMessage(''); setWorking(true);
    const payload = { customerName: form.customerName.trim(), phone: form.phone.trim(), fulfillment: form.fulfillment, address: form.fulfillment === 'delivery' ? form.address.trim() : '', notes: form.notes.trim(), paymentMethod: form.fulfillment === 'delivery' ? 'pay_on_delivery' : 'pay_on_pickup', items: lines.map((line) => ({ id: line.id, quantity: line.quantity, options: line.options || [] })) };
    try {
      let created;
      if (onSubmitOrder) created = await onSubmitOrder(payload);
      else {
        created = { id: `MK-${globalThis.crypto?.randomUUID?.() || Date.now()}`, customer: payload.customerName, phone: payload.phone, note: payload.notes, items: lines.map((line) => ({ id: line.id, name: line.item.name, price: line.item.price, quantity: line.quantity, options: line.options || [] })), total: subtotal + deliveryFee, status: 'New', createdAt: new Date().toISOString() };
        setOrders?.((current) => [created, ...current]);
      }
      setReference(created?.order?.reference || created?.order?.id || created?.reference || created?.id || 'Saved');
      setTrackingToken(created?.trackingToken || '');
      setTrackingOrderId(created?.order?.id || created?.id || '');
      setCart([]); setStep('success'); setForm({ customerName: '', phone: '', fulfillment: 'pickup', address: '', notes: '' });
    } catch (error) { setMessage(error?.message || 'Your order could not be saved. Please try again.'); }
    finally { setWorking(false); }
  }
  if (!open) return null;
  return <div className="m-drawer-layer"><button type="button" className="m-drawer-backdrop" onClick={close} aria-label="Close basket" /><aside className="m-cart-drawer" ref={drawerRef} role="dialog" aria-modal="true" aria-label="Your basket"><div className="m-drawer-top"><span>YOUR MIKUN ORDER</span><button type="button" onClick={close} aria-label="Close basket" autoFocus><Icon name="close" size={22} /></button></div>{step === 'success' ? <div className="m-cart-success"><span><Icon name="check" size={31} /></span><h2>Order request saved.</h2><p>Your reference is <strong>{reference}</strong>.</p><p>{onSubmitOrder ? 'Keep this reference to follow up with the restaurant.' : 'This preview order is stored in your browser and was not sent to MIKUN.'}</p>{trackingToken && <div className="m-tracking-code"><span>SAVE THIS TRACKING CODE</span><code>{trackingToken}</code><small>You will need this code to check your order from another device.</small></div>}{trackingOrderId && <a className="m-track-link" href={"/track?order=" + encodeURIComponent(trackingOrderId)}>Track order <Icon name="arrow" size={17} /></a>}<button type="button" className="m-button m-button-green" onClick={close}>Keep exploring <Icon name="arrow" size={18} /></button></div> : <><div className="m-drawer-intro"><h2>{step === 'basket' ? 'Your basket.' : 'One last step.'}</h2><p>{step === 'basket' ? 'The good stuff, all in one place.' : 'Tell us where this order is going.'}</p></div>{step === 'basket' ? <><div className="m-cart-lines">{lines.length ? lines.map((line) => <div className="m-cart-line" key={line.key || line.id}><div><h3>{line.item.name}</h3>{itemOptionDetails(line.item, line.options).map((option) => <small className="m-cart-option" key={option.label}>{option.label}</small>)}<span>{formatPrice(Number(line.item.price) + itemOptionDetails(line.item, line.options).reduce((extra, option) => extra + option.priceDelta, 0), settings.currency || '₦')}</span></div><div className="m-qty"><button type="button" onClick={() => adjust(line.key || line.id, -1)} aria-label={`Remove one ${line.item.name}`}><Icon name="minus" size={15} /></button><span>{line.quantity}</span><button type="button" onClick={() => adjust(line.key || line.id, 1)} aria-label={`Add one ${line.item.name}`}><Icon name="plus" size={15} /></button></div></div>) : <div className="m-cart-empty"><Icon name="bag" size={38} /><h3>Nothing in the basket yet.</h3><p>Your next favourite is waiting on the menu.</p></div>}</div><div className="m-cart-bottom"><div className="m-cart-total"><span>Subtotal</span><strong>{formatPrice(subtotal, settings.currency || '₦')}</strong></div><button type="button" className="m-button m-button-green" disabled={!lines.length || settings.acceptingOrders === false} onClick={() => setStep('checkout')}>Continue to details <Icon name="arrow" size={18} /></button>{settings.acceptingOrders === false && <p>Online ordering is paused right now.</p>}</div></> : <form className="m-checkout" onSubmit={submit}><button type="button" className="m-back" onClick={() => setStep('basket')}>← Back to basket</button><label>Your name<input required name="customerName" value={form.customerName} onChange={change} maxLength={80} autoComplete="name" /></label><label>Phone number<input required type="tel" name="phone" value={form.phone} onChange={change} maxLength={30} autoComplete="tel" /></label><fieldset><legend>How would you like it?</legend><label><input type="radio" name="fulfillment" value="pickup" checked={form.fulfillment === 'pickup'} onChange={change} /> Pickup</label><label><input type="radio" name="fulfillment" value="delivery" checked={form.fulfillment === 'delivery'} onChange={change} /> Delivery</label></fieldset>{form.fulfillment === 'delivery' && <label>Delivery address<textarea required name="address" rows="2" value={form.address} onChange={change} maxLength={300} autoComplete="street-address" /></label>}<label>Order note <span>(optional)</span><textarea name="notes" rows="2" value={form.notes} onChange={change} maxLength={300} /></label><div className="m-cart-total"><span>Subtotal</span><strong>{formatPrice(subtotal, settings.currency || '₦')}</strong></div>{form.fulfillment === 'delivery' && <div className="m-cart-total"><span>Delivery fee</span><strong>{settings.deliveryFee ? formatPrice(deliveryFee, settings.currency || '₦') : 'To be confirmed'}</strong></div>}<div className="m-cart-total is-grand"><span>{form.fulfillment === 'delivery' && !settings.deliveryFee ? 'Food total' : 'Total'}</span><strong>{formatPrice(subtotal + deliveryFee, settings.currency || '₦')}</strong></div><p className="m-payment-note">Online payment is not available yet. The restaurant can confirm payment details.</p>{message && <p className="m-form-status is-error" role="alert">{message}</p>}<button className="m-button m-button-green" type="submit" disabled={working}>{working ? 'Saving order…' : onSubmitOrder ? 'Place order request' : 'Save preview order'} <Icon name="arrow" size={18} /></button></form>}</>}</aside></div>;
}

export default function PublicSite({ menu = [], setOrders, settings = {}, content = {}, theme = 'light', toggleTheme = () => {}, onSubmitOrder, onSubmitReservation, reviews = [], loading = false, loadError = '' }) {
  const [cart, setCart] = useStoredValue('mikun-cart-v2', []);
  const [favorites, setFavorites] = useStoredValue('mikun-favorites-v1', []);
  const [cartOpen, setCartOpen] = useState(false);
  const [configureItem, setConfigureItem] = useState(null);
  const count = cart.reduce((sum, line) => menu.some((item) => item.id === line.id && item.available !== false) ? sum + line.quantity : sum, 0);
  const addConfigured = (item, selections = []) => {
    const options = [...selections].sort((a, b) => a.groupId.localeCompare(b.groupId));
    const key = `${item.id}:${options.map((entry) => `${entry.groupId}=${entry.choiceId}`).join('|')}`;
    setCart((current) => {
      const found = current.find((line) => (line.key || `${line.id}:`) === key);
      return found ? current.map((line) => (line.key || `${line.id}:`) === key ? { ...line, quantity: line.quantity + 1 } : line) : [...current, { id: item.id, key, options, quantity: 1 }];
    });
    setConfigureItem(null); setCartOpen(true);
  };
  const addItem = (item) => { if (item.options?.length) setConfigureItem(item); else addConfigured(item); };
  return <div className="m-site"><Header count={count} openCart={() => setCartOpen(true)} theme={theme} toggleTheme={toggleTheme} /><main><Hero settings={settings} content={content} /><div className="m-brand-strip" aria-hidden="true"><span>MADE FOR YOUR APPETITE</span><b>✳</b><span>MADE FOR THE MOMENT</span><b>✳</b><span>MADE FOR GOOD VIBES</span></div><FoodStory /><MenuSection menu={menu} settings={settings} onAdd={addItem} favorites={favorites} setFavorites={setFavorites} loading={loading} loadError={loadError} /><About settings={settings} content={content} /><Gallery /><Reservation settings={settings} onSubmitReservation={onSubmitReservation} /><Reviews reviews={reviews} /><Contact settings={settings} /></main><Footer settings={settings} theme={theme} toggleTheme={toggleTheme} /><button type="button" className={count ? 'm-floating-cart is-visible' : 'm-floating-cart'} onClick={() => setCartOpen(true)} aria-label={`Open basket, ${count} items`}><Icon name="bag" size={20} /> Basket <strong>{count}</strong></button>{configureItem && <ItemOptionsDialog key={configureItem.id} item={configureItem} currency={settings.currency} onClose={() => setConfigureItem(null)} onAdd={addConfigured} />}<CartDrawer open={cartOpen} onClose={() => setCartOpen(false)} cart={cart} setCart={setCart} menu={menu} settings={settings} onSubmitOrder={onSubmitOrder} setOrders={setOrders} /></div>;
}
