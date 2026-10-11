// Control Center's toast: the shared 'alternate:toast' contract (utils/toast.js) with "success" as the default tone, and the shared
// FastAPI-error reader (utils/errorMessage.js, which also copes with validation-error arrays).
import { toast as send } from '../../utils/toast';

export const toast = (message, tone = 'success') => send(message, tone === 'error' ? 'error' : 'success');
export { errorMessage as errorText } from '../../utils/errorMessage';
