(() => {
  if (location.protocol !== 'https:' || location.hostname !== 'r90.liderrr.cc') return;
  const beacon = document.createElement('script');
  beacon.type = 'module';
  beacon.src = 'https://static.cloudflareinsights.com/beacon.min.js';
  beacon.dataset.cfBeacon = JSON.stringify({token:'7387d393aee7478b8b9c9b7658b32355'});
  document.head.append(beacon);
})();
