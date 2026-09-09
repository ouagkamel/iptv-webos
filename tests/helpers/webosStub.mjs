// tests/helpers/webosStub.mjs — stub du SDK webostvjs : deviceInfo paramétrable.
export const __device = { info: null }; // info = { sdkVersion, modelName } | null

export default {
  deviceInfo: function (cb) {
    if (__device.info) cb(__device.info);
    // sinon : pas de réponse → timeout 1000 ms du CapabilityDetector teste le baseline
  },
  platformBack: function () { __device.platformBackCalls = (__device.platformBackCalls || 0) + 1; }
};
