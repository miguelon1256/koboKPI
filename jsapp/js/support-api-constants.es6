const host = window.location.hostname.split('.')
export const SUPPORT_API_BASE_URL = `http://support.${host[host.length - 3]}.${host[host.length - 2]}.${host[host.length - 1]}:8500`;
export const SUPPORT_API_SHINY_BASE_URL = `http://dashboards.${host[host.length - 3]}.${host[host.length - 2]}.${host[host.length - 1]}:3838`;