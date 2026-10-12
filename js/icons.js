const paths = {
  pointer: '<path d="m5 3 14 9-7 2-3 7z"/>',
  hand: '<path d="M8 12V6a2 2 0 0 1 4 0v5-6a2 2 0 0 1 4 0v6-4a2 2 0 0 1 4 0v8a7 7 0 0 1-7 7h-1a6 6 0 0 1-5-3l-4-6a2 2 0 0 1 3-2l2 3"/>',
  sticky: '<path d="M4 4h16v11l-5 5H4z"/><path d="M15 20v-5h5"/>',
  text: '<path d="M4 5h16M12 5v15M8 20h8M4 5v3M20 5v3"/>',
  rectangle: '<rect x="4" y="5" width="16" height="14" rx="2"/>',
  circle: '<circle cx="12" cy="12" r="8"/>',
  diamond: '<path d="m12 3 9 9-9 9-9-9z"/>',
  arrow: '<path d="M5 19 19 5M8 5h11v11"/>',
  pen: '<path d="m15 4 5 5-11 11-6 1 1-6zM13 6l5 5"/>',
  frame: '<path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/>',
  image:
    '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1.5"/><path d="m4 17 5-5 4 4 3-3 5 5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  chevron: '<path d="m8 10 4 4 4-4"/>',
  right: '<path d="m9 5 7 7-7 7"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  check: '<path d="m5 12 4 4 10-10"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  github:
    '<path d="M9 20c-5 1-5-2-7-2m14 4v-4a4 4 0 0 0-1-3c3 0 6-2 6-5a5 5 0 0 0-1-3 4 4 0 0 0 0-4s-1 0-4 2a12 12 0 0 0-8 0C5 3 4 3 4 3a4 4 0 0 0 0 4 5 5 0 0 0-1 3c0 3 3 5 6 5a4 4 0 0 0-1 3v4"/>',
  branch:
    '<circle cx="6" cy="5" r="2"/><circle cx="18" cy="6" r="2"/><circle cx="6" cy="19" r="2"/><path d="M6 7v10M18 8c0 7-12 2-12 8"/>',
  cloud:
    '<path d="M7 18a5 5 0 0 1-1-10 7 7 0 0 1 13 2 4 4 0 0 1-1 8"/><path d="m9 13 3-3 3 3M12 10v10"/>',
  undo: '<path d="M3 10h12a6 6 0 0 1 0 12M3 10l5-5M3 10l5 5"/>',
  redo: '<path d="M21 10H9a6 6 0 0 0 0 12M21 10l-5-5M21 10l-5 5"/>',
  trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/>',
  copy: '<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V3H3v13h5"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  upload: '<path d="M12 16V4m-5 5 5-5 5 5M4 16v5h16v-5"/>',
  more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  fit: '<path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/><rect x="8" y="8" width="8" height="8" rx="1"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9 8a3 3 0 0 1 6 1c0 2-3 2-3 5M12 17h.01"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V6a4 4 0 0 1 8 0v4"/>',
  unlock:
    '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V6a4 4 0 0 1 8-2"/>',
  refresh:
    '<path d="M20 8a8 8 0 0 0-14-3L3 8M3 3v5h5M4 16a8 8 0 0 0 14 3l3-3M21 21v-5h-5"/>',
  external: '<path d="M14 3h7v7M21 3 10 14M10 3H3v18h18v-7"/>',
  board:
    '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M8 4v16M8 10h13"/>',
  spark:
    '<path d="m12 3 2.6 6.4L21 12l-6.4 2.6L12 21l-2.6-6.4L3 12l6.4-2.6z"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  line: '<path d="M4 19 20 5"/>',
  bold: '<path d="M6 3h7a4.5 4.5 0 0 1 0 9H6zm0 9h8a4.5 4.5 0 0 1 0 9H6z"/>',
  front:
    '<rect x="3" y="3" width="12" height="12" rx="2"/><path d="M15 9h6v12H9v-6"/>',
  back: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M9 15H3V3h12v6"/>',
  folder: '<path d="M3 6h7l2 3h9v11H3z"/>',
  palette:
    '<circle cx="12" cy="12" r="9"/><circle cx="7" cy="10" r="1"/><circle cx="11" cy="6" r="1"/><circle cx="16" cy="8" r="1"/><path d="M14 20c-3-4 4-5 6-6"/>',
  comment:
    '<path d="M21 11a8 8 0 0 1-8 8H7l-4 3V5a2 2 0 0 1 2-2h8a8 8 0 0 1 8 8z"/>',
};
export function icon(name, size = 20) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.board}</svg>`;
}
