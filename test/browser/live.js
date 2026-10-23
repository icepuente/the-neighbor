// The browser test against the live site (default https://book.icepuente.com/, or SITE). It sends
// nothing and stores nothing: `npm run test:live`.
process.env.SITE ||= 'https://book.icepuente.com/';
await import('./site.js');
