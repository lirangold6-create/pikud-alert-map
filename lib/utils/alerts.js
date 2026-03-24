/**
 * Alert classification utilities
 * 
 * Identifies alert types based on Hebrew title text.
 * Used across server, collector, trainer, and analysis scripts.
 */

function isOrange(title) {
  if (!title) return false;
  return title.includes('בדקות הקרובות') || 
         title.includes('צפויות להתקבל') || 
         title.includes('expected alert');
}

function isRed(title) {
  if (!title) return false;
  return title.includes('ירי רקטות וטילים') && 
         !title.includes('האירוע הסתיים');
}

function isGreen(title) {
  if (!title) return false;
  return title.includes('האירוע הסתיים') || 
         title.includes('ניתן לצאת');
}

function alertKey(alert) {
  return `${alert.alertDate}|${alert.data}|${alert.title}`;
}

function getAlertType(title) {
  if (isRed(title)) return 'red';
  if (isOrange(title)) return 'orange';
  if (isGreen(title)) return 'green';
  return 'unknown';
}

module.exports = {
  isOrange,
  isRed,
  isGreen,
  alertKey,
  getAlertType
};
