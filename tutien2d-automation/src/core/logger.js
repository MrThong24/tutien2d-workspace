A.createLogger = function (limit = 300) {
  const records = [];
  return {
    add(event, data = {}) {
      records.push({ time: new Date().toISOString(), event, data });
      if (records.length > limit) records.splice(0, records.length - limit);
    },
    records() { return JSON.parse(JSON.stringify(records)); },
    size() { return records.length; }
  };
};
