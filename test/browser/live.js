// The browser test against the live site (default https://theneighbor.dk/, or SITE). It sends
// nothing and stores nothing: `npm run test:live`.
process.env.SITE ||= 'https://theneighbor.dk/';
await import('./site.js');
