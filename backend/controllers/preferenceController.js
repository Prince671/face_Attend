const UserPreference = require('../models/UserPreference');

const ALLOWED_PREF_KEYS = new Set([
  'theme',
  'chat.nicknames',
  'chat.quickReplies',
  'lms.activity',
  'classroom.lastSection',
]);

const MAX_PREF_BYTES = 50 * 1024;

const isAllowedKey = (key = '') => ALLOWED_PREF_KEYS.has(String(key || '').trim());

const preferencePayloadTooLarge = (value) => {
  try {
    return Buffer.byteLength(JSON.stringify(value ?? null), 'utf8') > MAX_PREF_BYTES;
  } catch {
    return true;
  }
};

const normalizePreferenceDoc = (doc) => ({
  key: doc.key,
  value: doc.value,
  updatedAt: doc.updatedAt,
});

const getPreferences = async (req, res) => {
  try {
    const docs = await UserPreference.find({ user: req.user._id }).lean();
    const preferences = docs.reduce((acc, doc) => {
      acc[doc.key] = doc.value;
      return acc;
    }, {});
    res.json({ success: true, preferences });
  } catch (err) {
    console.error('getPreferences error:', err);
    res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
};

const getPreference = async (req, res) => {
  try {
    const key = String(req.params.key || '').trim();
    if (!isAllowedKey(key)) {
      return res.status(400).json({ success: false, message: 'Unsupported preference key' });
    }
    const doc = await UserPreference.findOne({ user: req.user._id, key }).lean();
    res.json({ success: true, key, value: doc?.value ?? null, found: Boolean(doc) });
  } catch (err) {
    console.error('getPreference error:', err);
    res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
};

const setPreference = async (req, res) => {
  try {
    const key = String(req.params.key || '').trim();
    if (!isAllowedKey(key)) {
      return res.status(400).json({ success: false, message: 'Unsupported preference key' });
    }

    const value = req.body?.value ?? null;
    if (preferencePayloadTooLarge(value)) {
      return res.status(413).json({ success: false, message: 'Preference data is too large' });
    }

    const doc = await UserPreference.findOneAndUpdate(
      { user: req.user._id, key },
      { $set: { value } },
      { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true }
    );

    res.json({ success: true, preference: normalizePreferenceDoc(doc) });
  } catch (err) {
    console.error('setPreference error:', err);
    res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
};

const deletePreference = async (req, res) => {
  try {
    const key = String(req.params.key || '').trim();
    if (!isAllowedKey(key)) {
      return res.status(400).json({ success: false, message: 'Unsupported preference key' });
    }
    await UserPreference.deleteOne({ user: req.user._id, key });
    res.json({ success: true });
  } catch (err) {
    console.error('deletePreference error:', err);
    res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
};

module.exports = {
  getPreferences,
  getPreference,
  setPreference,
  deletePreference,
};
