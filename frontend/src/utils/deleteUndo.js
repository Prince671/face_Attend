import toast from 'react-hot-toast';

export const notifyPendingDeletionChanged = () => {
  window.dispatchEvent(new Event('pending-deletions:changed'));
};

export const handleDeleteScheduled = ({ response, label, refresh }) => {
  toast.success(response?.data?.message || `${label} delete scheduled`);
  notifyPendingDeletionChanged();
  refresh?.();
};
