export function slugify(title) {
    return title.toLowerCase().replace(/[ /]/g, '-').slice(0, 40);
}
