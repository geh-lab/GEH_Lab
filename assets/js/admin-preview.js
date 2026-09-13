// A temporary, explicit local preview. Public hosts always use normal authentication.
export function allowsAdminPreview({ hostname = '', pathname = '', search = '' } = {}) {
  return ['localhost', '127.0.0.1', '[::1]', '::1'].includes(hostname)
    && pathname.endsWith('/admin.html')
    && new URLSearchParams(search).get('preview') === '1';
}
