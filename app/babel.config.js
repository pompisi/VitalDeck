// expo + router preset covers the routes; the worklets plugin (reanimated v4)
// MUST be listed last or animations silently break at runtime
module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: ['react-native-worklets/plugin'],
  };
};
