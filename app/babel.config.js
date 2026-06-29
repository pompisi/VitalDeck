// minimal expo + router babel config; router's plugin handles the file-based
// routes and expo-preset covers the rest
module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
  };
};
