/** Small line icons (24px grid, 1.8 stroke), drawn here so the app needs no icon package. */
const P: Record<string, React.ReactNode> = {
  home: <><path d="M3 11.5 12 4l9 7.5" /><path d="M5.5 10v9.5h13V10" /><path d="M10 19.5v-5h4v5" /></>,
  chat: <path d="M4 5.5h16v10H9.5L5 19.5v-4H4z" />,
  inbox: <><path d="M3.5 13.5 6 5.5h12l2.5 8" /><path d="M3.5 13.5v5h17v-5h-5l-1 2h-5l-1-2z" /></>,
  calendar: <><rect x="3.5" y="5" width="17" height="15" rx="2" /><path d="M3.5 10h17M8 3v4M16 3v4" /></>,
  check: <><rect x="3.5" y="5" width="17" height="15" rx="2" /><path d="M3.5 10h17M8 3v4M16 3v4M9 15l2 2 4-4" /></>,
  book: <><path d="M5 4.5h10.5a2.5 2.5 0 0 1 2.5 2.5v13H7.5A2.5 2.5 0 0 1 5 17.5z" /><path d="M5 17.5A2.5 2.5 0 0 1 7.5 15H18" /></>,
  gear: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" transform="translate(12 12) scale(.88) translate(-12 -12)" /></>,
  database: <><ellipse cx="12" cy="6" rx="7.5" ry="2.8" /><path d="M4.5 6v12c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8V6M4.5 12c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8" /></>,
  tag: <><path d="M3.5 12.5V4.5a1 1 0 0 1 1-1h8l8 8a1 1 0 0 1 0 1.4l-7.1 7.1a1 1 0 0 1-1.4 0z" /><circle cx="8" cy="8" r="1.3" /></>,
  contact: <><rect x="3.5" y="5" width="17" height="14" rx="2" /><circle cx="9" cy="11" r="2" /><path d="M5.8 16.2c.6-1.5 1.7-2.2 3.2-2.2s2.6.7 3.2 2.2M14.5 10h3.5M14.5 13.5h3.5" /></>,
  sliders: <><path d="M4 7h9M17 7h3M4 17h3M11 17h9" /><circle cx="15" cy="7" r="2" /><circle cx="9" cy="17" r="2" /></>,
  mic: <><rect x="9" y="3.5" width="6" height="11" rx="3" /><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v2.5" /></>,
  globe: <><circle cx="12" cy="12" r="8.5" /><path d="M3.5 12h17M12 3.5c2.5 2.4 3.5 5.2 3.5 8.5s-1 6.1-3.5 8.5c-2.5-2.4-3.5-5.2-3.5-8.5s1-6.1 3.5-8.5z" /></>,
  wallet: <><path d="M4 7.5h14.5a1.5 1.5 0 0 1 1.5 1.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18z" /><path d="M4 7.5 15.5 4v3.5M16 14h2.5" /></>,
  chart: <><path d="M4 20h16" /><path d="M7 20v-7M12 20V6M17 20v-10" /></>,
  bell: <><path d="M6 17.5V11a6 6 0 0 1 12 0v6.5l1.5 1.5h-15z" /><path d="M10 21h4" /></>,
  users: <><circle cx="9" cy="8.5" r="3.2" /><path d="M3 19.5a6 6 0 0 1 12 0M16 5.5a3.2 3.2 0 0 1 0 6M18 14.5a6 6 0 0 1 3 5" /></>,
  tick: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  user: <><circle cx="12" cy="8.5" r="3.5" /><path d="M5 20a7 7 0 0 1 14 0" /></>,
  key: <><circle cx="8" cy="15" r="3.5" /><path d="M10.5 12.5 19 4M16 7l2.5 2.5M13.5 9.5 15.5 11.5" /></>,
  list: <><path d="M9 6h11M9 12h11M9 18h11" /><circle cx="4.5" cy="6" r="1" /><circle cx="4.5" cy="12" r="1" /><circle cx="4.5" cy="18" r="1" /></>,
  package: <><path d="M12 3.5 20 8v8l-8 4.5L4 16V8z" /><path d="M4 8l8 4.5L20 8M12 12.5v8" /></>,
  palette: <><path d="M12 3.5a8.5 8.5 0 1 0 0 17c1.4 0 2-1 1.5-2-.6-1.2.2-2.5 1.6-2.5H17a3.5 3.5 0 0 0 3.5-3.5C20.5 7.2 16.7 3.5 12 3.5z" /><circle cx="7.5" cy="11" r="1" /><circle cx="10" cy="7.5" r="1" /><circle cx="14.5" cy="7.5" r="1" /></>,
  usage: <><path d="M4 19.5 9 13l3.5 3.5L20 7.5" /><path d="M15 7.5h5v5" /></>,
  phone: <path d="M6.5 4h3l1.5 4-2 1.5a11 11 0 0 0 5.5 5.5l1.5-2 4 1.5v3a2 2 0 0 1-2 2A15.5 15.5 0 0 1 4.5 6a2 2 0 0 1 2-2z" />,
  alert: <><path d="M12 4 21 19.5H3z" /><path d="M12 10v4.5M12 17.2v.1" /></>,
  siren: <><path d="M7 18.5v-5a5 5 0 0 1 10 0v5M5 18.5h14M12 3.5v2M4.5 7l1.5 1.2M19.5 7 18 8.2" /></>,
  flag: <><path d="M6 21V4.5M6 5h11l-2 3.5 2 3.5H6" /></>,
  target: <><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="4.5" /><circle cx="12" cy="12" r="1" /></>,
  shield: <><path d="M12 3.5 19 6v5.5c0 4.2-2.9 7.6-7 9-4.1-1.4-7-4.8-7-9V6z" /><path d="M9 12l2 2 4-4" /></>,
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  more: <><circle cx="5.5" cy="12" r="1.2" /><circle cx="12" cy="12" r="1.2" /><circle cx="18.5" cy="12" r="1.2" /></>,
  install: <><rect x="7" y="3" width="10" height="18" rx="2.5" /><path d="M12 8v6M9.5 11.8 12 14.3l2.5-2.5M11 18h2" /></>,
  download: <><path d="M12 4v11M7.5 11l4.5 4.5 4.5-4.5M5 19.5h14" /></>,
  print: <><path d="M7 9V4h10v5M7 17H4.5v-7.5h15V17H17" /><rect x="7" y="14" width="10" height="6" /></>,
  logout: <><path d="M10 4.5H5.5v15H10M14.5 8l4 4-4 4M18.5 12H9.5" /></>,
  eye: <><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" /><circle cx="12" cy="12" r="3" /></>,
  language: <><path d="M4 6h10M9 4v2M6 6c0 4 3 7 6.5 8.5M13 6c-.5 3-3 6.5-8 9M13 20l4-9 4 9M14.5 17h5" /></>,
};

export function Icon({ name, size = 20 }: { name: keyof typeof P | string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" className="icon">
      {P[name] ?? P.home}
    </svg>
  );
}
