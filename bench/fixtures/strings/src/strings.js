export function capitalize(text) {
  if (!text) return '';
  return text[0].toUpperCase() + text.slice(1);
}

export function truncate(text, max) {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}
