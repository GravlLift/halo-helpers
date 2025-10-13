export function getGamerpicUrl(baseUrl: URL, size: number) {
  const newUrl = new URL(baseUrl.toString());
  newUrl.searchParams.set('w', size.toString());
  newUrl.searchParams.set('h', size.toString());
  return newUrl.toString();
}
