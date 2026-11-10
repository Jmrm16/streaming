const path = require('node:path');
const svcDir = path.resolve(__dirname, 'webos', 'services', 'com.webosflux.xuptertv.fidelity.service');
const magis = require(path.join(svcDir, 'magis.js'));

console.log('Fetching a series from catalog...');
magis.home('series', 1, (err, data) => {
  if (err || !data) {
    console.error('Error fetching series list:', err);
    process.exit(1);
  }
  const items = data.items || data;
  const firstSeries = items[0];
  console.log('First series:', firstSeries.title, 'ID:', firstSeries.id);

  magis.detail(firstSeries.id, (err2, detail) => {
    if (err2) {
      console.error('Error fetching detail:', err2);
      process.exit(1);
    }
    console.log('Detail keys:', Object.keys(detail));
    console.log('Seasons:', detail.seasons);
    console.log('Episodes count:', detail.episodes ? detail.episodes.length : 0);
    if (detail.episodes && detail.episodes.length > 0) {
      console.log('Sample episode 0:', detail.episodes[0]);
      console.log('Sample episode last:', detail.episodes[detail.episodes.length - 1]);
    }
    process.exit(0);
  });
});
