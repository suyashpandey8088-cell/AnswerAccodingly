import '../dashboard/styles.css';
import { bootPopupApp } from './popup-app';

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      void bootPopupApp();
    });
  } else {
    void bootPopupApp();
  }
}
