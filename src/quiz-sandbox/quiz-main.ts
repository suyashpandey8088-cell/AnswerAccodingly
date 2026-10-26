import '../dashboard/styles.css';
import { bootQuizLabBrowserPage } from './quiz-app';

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      bootQuizLabBrowserPage();
    });
  } else {
    bootQuizLabBrowserPage();
  }
}
