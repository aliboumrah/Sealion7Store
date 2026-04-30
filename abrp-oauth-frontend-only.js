/**
 * ABRP OAuth Implementation - Frontend Only
 * 
 * This is the PROPER way to handle ABRP OAuth:
 * - Frontend exchanges the code directly with ABRP
 * - Backend never touches credentials
 * - Backend only provides car metrics to ABRP API
 * 
 * Add this code to your frontend (index.html) instead of relying on backend OAuth
 */

// ============================================================================
// ABRP OAuth - Frontend Only Implementation
// ============================================================================

const ABRP_OAUTH_CONFIG = {
  // Public credentials (safe to expose in frontend)
  client_id: "SEALION 7 PILOT",
  redirect_uri: "https://aliboumrah.github.io/Sealion7Store/",
  scope: "set_telemetry",
  
  // OAuth endpoints
  auth_url: "https://abetterrouteplanner.com/oauth/auth",
  token_url: "https://api.iternio.com/1/oauth/token",
  api_base: "https://api.iternio.com/1"
};

/**
 * Step 1: Initiate OAuth login
 * User clicks "Login with ABRP" button
 */
function abrpStartOAuthLogin() {
  const state = generateRandomState(32);
  localStorage.setItem('abrp_oauth_state', state);
  
  const authUrl = new URL(ABRP_OAUTH_CONFIG.auth_url);
  authUrl.searchParams.append('client_id', ABRP_OAUTH_CONFIG.client_id);
  authUrl.searchParams.append('redirect_uri', ABRP_OAUTH_CONFIG.redirect_uri);
  authParams.append('scope', ABRP_OAUTH_CONFIG.scope);
  authUrl.searchParams.append('response_type', 'code');
  authUrl.searchParams.append('state', state);
  
  console.log('🔐 Redirecting to ABRP login:', authUrl.toString());
  window.location.href = authUrl.toString();
}

/**
 * Step 2: Handle OAuth redirect (runs automatically when page loads)
 * ABRP redirects back with ?code=AUTH_CODE&state=STATE
 */
async function handleAbrpOAuthCallback() {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  const state = params.get('state');
  const error = params.get('error');
  const error_desc = params.get('error_description');
  
  if (error) {
    console.error('❌ ABRP OAuth error:', error, error_desc);
    showAbrpStatus('OAuth failed: ' + error, 'var(--red)');
    return false;
  }
  
  if (!code) {
    console.log('No OAuth code in URL (first visit or manual redirect)');
    return false;
  }
  
  console.log('✅ Received OAuth code from ABRP');
  
  // Validate state to prevent CSRF
  const savedState = localStorage.getItem('abrp_oauth_state');
  if (state !== savedState) {
    console.error('❌ State mismatch - possible CSRF attack');
    showAbrpStatus('Security error: state mismatch', 'var(--red)');
    return false;
  }
  
  // Exchange code for token (Step 3)
  return await exchangeCodeForToken(code);
}

/**
 * Step 3: Exchange authorization code for access token
 * This happens ENTIRELY in the frontend, no backend involved
 */
async function exchangeCodeForToken(code) {
  console.log('🔄 Exchanging authorization code for access token...');
  showAbrpStatus('Exchanging code with ABRP...', 'var(--accent)');
  
  try {
    // Create form data (ABRP requires application/x-www-form-urlencoded)
    const formData = new URLSearchParams({
      grant_type: 'authorization_code',
      code: code,
      client_id: ABRP_OAUTH_CONFIG.client_id,
      redirect_uri: ABRP_OAUTH_CONFIG.redirect_uri
    });
    
    // Post to ABRP's token endpoint
    const response = await fetch(ABRP_OAUTH_CONFIG.token_url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json'
      },
      body: formData.toString()
    });
    
    const data = await response.json();
    
    if (data.error) {
      throw new Error(data.error_description || data.error);
    }
    
    if (!data.access_token) {
      throw new Error('No access_token in ABRP response');
    }
    
    console.log('✅ Successfully exchanged code for access token');
    
    // Save token to localStorage
    const tokenData = {
      access_token: data.access_token,
      token_type: data.token_type || 'Bearer',
      expires_in: data.expires_in || 3600,
      saved_at: Date.now(),
      refresh_token: data.refresh_token || null
    };
    
    localStorage.setItem('abrp_token', JSON.stringify(tokenData));
    localStorage.removeItem('abrp_oauth_state'); // Clean up
    
    // Fetch user info to confirm connection
    const userInfo = await fetchAbrpUserInfo(data.access_token);
    
    // Store user info
    if (userInfo && !userInfo.error) {
      localStorage.setItem('abrp_user', JSON.stringify(userInfo));
    }
    
    // Clean OAuth code from URL
    window.history.replaceState({}, document.title, window.location.pathname);
    
    // Update UI
    showAbrpStatus('✅ Connected to ABRP', 'var(--green)');
    updateAbrpUI(data.access_token, userInfo);
    
    return true;
    
  } catch (error) {
    console.error('❌ OAuth exchange failed:', error);
    showAbrpStatus('OAuth failed: ' + error.message, 'var(--red)');
    localStorage.setItem('abrp_oauth_error', error.message);
    return false;
  }
}

/**
 * Step 4: Fetch ABRP user info to confirm token is valid
 */
async function fetchAbrpUserInfo(accessToken) {
  try {
    const response = await fetch(ABRP_OAUTH_CONFIG.api_base + '/user/info?access_token=' + encodeURIComponent(accessToken), {
      headers: {
        'Accept': 'application/json'
      }
    });
    
    const data = await response.json();
    
    if (data.error) {
      throw new Error(data.error);
    }
    
    console.log('✅ User info retrieved:', data.full_name);
    return data;
    
  } catch (error) {
    console.warn('⚠️ Could not fetch user info:', error.message);
    return null;
  }
}

/**
 * Helper: Generate random string for state parameter (CSRF protection)
 */
function generateRandomState(length) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/**
 * Helper: Get stored token
 */
function getAbrpToken() {
  try {
    const tokenData = JSON.parse(localStorage.getItem('abrp_token') || '{}');
    
    // Check if token is expired
    if (tokenData.saved_at && tokenData.expires_in) {
      const expiresAt = tokenData.saved_at + (tokenData.expires_in * 1000);
      if (Date.now() > expiresAt) {
        console.warn('⚠️ ABRP token expired');
        localStorage.removeItem('abrp_token');
        return null;
      }
    }
    
    return tokenData.access_token || null;
  } catch {
    return null;
  }
}

/**
 * Helper: Check if user is connected to ABRP
 */
function isAbrpConnected() {
  return !!getAbrpToken();
}

/**
 * Helper: Get stored user info
 */
function getAbrpUser() {
  try {
    return JSON.parse(localStorage.getItem('abrp_user') || 'null');
  } catch {
    return null;
  }
}

/**
 * Helper: Show status message in ABRP UI
 */
function showAbrpStatus(message, color = 'var(--muted)') {
  const el = document.getElementById('abrp-status');
  if (el) {
    el.textContent = message;
    el.style.color = color;
  }
}

/**
 * Helper: Update ABRP UI after successful login
 */
function updateAbrpUI(token, userInfo) {
  const userBox = document.getElementById('abrp-user-info');
  const loginBox = document.getElementById('abrp-login-section');
  
  if (userBox) userBox.style.display = 'flex';
  if (loginBox) loginBox.style.display = 'none';
  
  if (userInfo) {
    const nameEl = document.getElementById('abrp-user-name');
    const emailEl = document.getElementById('abrp-user-email');
    const vehicleEl = document.getElementById('abrp-vehicle-name');
    
    if (nameEl) nameEl.textContent = '✅ ' + (userInfo.full_name || 'Connected to ABRP');
    if (emailEl) emailEl.textContent = userInfo.email || '';
    if (vehicleEl) vehicleEl.textContent = userInfo.vehicle_name ? '🚗 ' + userInfo.vehicle_name : 'Vehicle connected';
  }
}

/**
 * Helper: Disconnect from ABRP
 */
function disconnectAbrp() {
  localStorage.removeItem('abrp_token');
  localStorage.removeItem('abrp_user');
  localStorage.removeItem('abrp_oauth_state');
  localStorage.removeItem('abrp_oauth_error');
  
  const userBox = document.getElementById('abrp-user-info');
  const loginBox = document.getElementById('abrp-login-section');
  
  if (userBox) userBox.style.display = 'none';
  if (loginBox) loginBox.style.display = '';
  
  showAbrpStatus('Disconnected from ABRP', 'var(--yellow)');
}

/**
 * Auto-connect: Check for OAuth callback on page load
 * This runs automatically when page loads after ABRP redirects back
 */
(async function autoHandleAbrpOAuthCallback() {
  const handled = await handleAbrpOAuthCallback();
  if (!handled && isAbrpConnected()) {
    // Already connected, update UI
    const userInfo = getAbrpUser();
    updateAbrpUI(getAbrpToken(), userInfo);
  }
})();

// ============================================================================
// Export functions for use in UI
// ============================================================================

window.abrpStartOAuthLogin = abrpStartOAuthLogin;
window.getAbrpToken = getAbrpToken;
window.isAbrpConnected = isAbrpConnected;
window.getAbrpUser = getAbrpUser;
window.disconnectAbrp = disconnectAbrp;
window.showAbrpStatus = showAbrpStatus;

// ============================================================================
// BACKEND: All it needs to do is send metrics using the token
// ============================================================================

/**
 * Send telemetry to ABRP (backend calls this with car data)
 * 
 * Backend should do:
 * 1. Get car metrics from ADB/car service
 * 2. Call this with the metrics and ABRP token from localStorage
 * 
 * const token = await getAbrpTokenFromBrowser();
 * await sendAbrpTelemetry(token, {
 *   soc: 45.5,
 *   speed: 80,
 *   power: 25.3,
 *   ...
 * });
 */
async function sendAbrpTelemetry(token, metrics) {
  if (!token) {
    console.error('❌ No ABRP token available');
    return false;
  }
  
  try {
    // Build full telemetry payload
    const tlm = {
      utc: Math.floor(Date.now() / 1000),
      car_model: 'byd:sealion:25:82:rwd',
      ...metrics
    };
    
    // Send to ABRP
    const response = await fetch(
      ABRP_OAUTH_CONFIG.api_base + '/tlm/send?token=' + encodeURIComponent(token) +
      '&tlm=' + encodeURIComponent(JSON.stringify(tlm)),
      {
        headers: { 'Accept': 'application/json' }
      }
    );
    
    const data = await response.json();
    
    if (data.error) {
      console.error('❌ ABRP API error:', data.error);
      return false;
    }
    
    console.log('✅ Telemetry sent to ABRP');
    return true;
    
  } catch (error) {
    console.error('❌ Failed to send telemetry:', error);
    return false;
  }
}

window.sendAbrpTelemetry = sendAbrpTelemetry;
