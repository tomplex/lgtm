export function slugify(title: string): string {
  return title.toLowerCase().replace(/[ /]/g, '-').slice(0, 40);
}
