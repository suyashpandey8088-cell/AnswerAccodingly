import './styles.css';
import { bootDashboardApp } from './dashboard-app';

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      void bootDashboardApp();
    });
  } else {
    void bootDashboardApp();
  }
}
