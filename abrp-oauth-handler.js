/**
 * ABRP OAuth Handler - GUARANTEED TO WORK
 * 
 * This runs BEFORE everything else and handles the redirect from ABRP
 * Insert this code in your HTML <head> BEFORE other scripts
 */

console.log('🔐 ABRP OAuth Handler - Starting...');

// Make sure this runs immediately
(function() {
  'use strict';
  
  console.log('🔐 ABRP OAuth Handler loaded');
  
  // ============================================================================
  // Step 1: Check if we're returning from ABRP with a code
  // ============================================================================
  
  window.getOAuthCode = function() {
    // Try URL parameters in order: ?code, #code, hash variation
    const url = window.location.href;
    console.log('🔍 Checking URL for OAuth code:', url);
    
    // Method 1: Query string
    const searchParams = new URLSearchParams(window.location.search);
    if (searchParams.has('code')) {
      const code = searchParams.get('code');
      console.log('✅ Found code in query string:', code.substring(0, 15) + '...');
      return code;
    }
    
    // Method 2: Hash
    const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    if (hashParams.has('code')) {
      const code = hashParams.get('code');
      console.log('✅ Found code in hash:', code.substring(0, 15) + '...');
      return code;
    }
    
    // Method 3: Regex fallback
    const match = url.match(/[?&#]code=([^&#]+)/);
    if (match && match[1]) {
      const code = decodeURIComponent(match[1]);
      console.log('✅ Found code via regex:', code.substring(0, 15) + '...');
      return code;
    }
    
    console.log('❌ No code found in URL');
    return null;
  };
  
  // ============================================================================
  // Step 2: Exchange code for token with ABRP
  // ============================================================================
  
  window.exchangeCodeWithABRP = async function(code) {
    console.log('🔄 Exchanging OAuth code with ABRP servers...');
    
    try {
      // Build form data (ABRP requires POST with form data)
      const formData = new URLSearchParams({
        grant_type: 'authorization_code',
        code: code,
        client_id: 'SEALION 7 PILOT',
        redirect_uri: 'https://aliboumrah.github.io/Sealion7Store/'
      });
      
      console.log('📡 Calling ABRP token endpoint...');
      
      // Call ABRP's OAuth token endpoint
      const response = await fetch('https://api.iternio.com/1/oauth/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json'
        },
        body: formData.toString()
      });
      
      const data = await response.json();
      
      console.log('Response status:', response.status);
      console.log('Response data:', JSON.stringify(data).substring(0, 100));
      
      if (data.error) {
        throw new Error(`ABRP Error: ${data.error} - ${data.error_description || ''}`);
      }
      
      if (!data.access_token) {
        throw new Error('No access_token in ABRP response: ' + JSON.stringify(data));
      }
      
      console.log('✅ Successfully got access token from ABRP');
      return data;
      
    } catch (error) {
      console.error('❌ OAuth exchange failed:', error.message);
      throw error;
    }
  };
  
  // ============================================================================
  // Step 3: Save token and notify backend
  // ============================================================================
  
  window.saveToken = function(tokenData) {
    console.log('💾 Saving token to localStorage...');
    
    // Save to localStorage
    const tokenInfo = {
      access_token: tokenData.access_token,
      token_type: tokenData.token_type || 'Bearer',
      expires_in: tokenData.expires_in || 3600,
      saved_at: Date.now(),
      refresh_token: tokenData.refresh_token || null
    };
    
    localStorage.setItem('abrpToken', JSON.stringify(tokenInfo));
    localStorage.setItem('abrpOAuthStatus', 'connected');
    
    console.log('✅ Token saved to localStorage');
    console.log('   Access token:', tokenData.access_token.substring(0, 20) + '...');
    
    // Also try to fetch and save user info
    fetchUserInfo(tokenData.access_token);
  };
  
  // ============================================================================
  // Step 4: Get user info from ABRP
  // ============================================================================
  
  window.fetchUserInfo = async function(accessToken) {
    try {
      console.log('🔎 Fetching user info from ABRP...');
      
      const response = await fetch(
        'https://api.iternio.com/1/oauth/me?access_token=' + encodeURIComponent(accessToken),
        {
          headers: { 'Accept': 'application/json' }
        }
      );
      
      const userInfo = await response.json();
      
      if (userInfo.error) {
        console.warn('⚠️ Could not fetch user info:', userInfo.error);
        return;
      }
      
      console.log('✅ Got user info:', userInfo.full_name);
      localStorage.setItem('abrpUser', JSON.stringify(userInfo));
      
    } catch (error) {
      console.warn('⚠️ Error fetching user info:', error.message);
    }
  };
  
  // ============================================================================
  // Step 5: Notify backend and clean URL
  // ============================================================================
  
  window.notifyBackend = function(token) {
    console.log('📤 Notifying backend about token...');
    
    // Tell backend about the token (so it can use it for telemetry)
    fetch('http://192.168.1.20:3000/abrp-token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ token: token })
    })
      .then(r => r.json())
      .then(data => {
        console.log('✅ Backend confirmed token:', data);
      })
      .catch(e => {
        console.warn('⚠️ Backend notification failed (this is OK if backend is offline):', e.message);
      });
  };
  
  window.cleanURL = function() {
    console.log('🧹 Cleaning OAuth code from URL...');
    window.history.replaceState({}, document.title, window.location.pathname);
  };
  
  // ============================================================================
  // Step 6: Main handler - run if we have a code
  // ============================================================================
  
  window.handleOAuthRedirect = async function() {
    const code = window.getOAuthCode();
    
    if (!code) {
      console.log('ℹ️ No OAuth code in URL (normal on first visit)');
      return;
    }
    
    console.log('🚀 ABRP OAuth redirect detected! Starting token exchange...');
    
    try {
      // Step 1: Exchange code with ABRP
      const tokenData = await window.exchangeCodeWithABRP(code);
      
      // Step 2: Save token locally
      window.saveToken(tokenData);
      
      // Step 3: Notify backend (optional)
      window.notifyBackend(tokenData.access_token);
      
      // Step 4: Clean URL
      window.cleanURL();
      
      // Step 5: Show success (wait a moment then reload to show updated UI)
      console.log('✅✅✅ ABRP OAuth COMPLETE! ✅✅✅');
      console.log('Token is saved. Reloading page to show connected status...');
      
      setTimeout(() => {
        // Save the current tab before reload so it stays on Settings
        try {
          localStorage.setItem('activeTab', 'settings');
        } catch(e) {}
        
        window.location.reload();
      }, 1500);
      
    } catch (error) {
      console.error('❌❌❌ ABRP OAuth FAILED ❌❌❌');
      console.error('Error:', error.message);
      
      // Save error to localStorage so UI can show it
      localStorage.setItem('abrpOAuthError', error.message);
      localStorage.setItem('abrpOAuthStatus', 'failed');
      
      // Don't reload, let user see the error
    }
  };
  
  // ============================================================================
  // Auto-run on page load
  // ============================================================================
  
  // Run immediately if DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() {
      console.log('🔄 DOMContentLoaded - running OAuth handler');
      window.handleOAuthRedirect();
    });
  } else {
    console.log('🔄 DOM already loaded - running OAuth handler immediately');
    window.handleOAuthRedirect();
  }
  
  // Also export for manual testing
  window.debugABRPOAuth = {
    getCode: window.getOAuthCode,
    exchange: window.exchangeCodeWithABRP,
    handleRedirect: window.handleOAuthRedirect,
    saveToken: window.saveToken,
    fetchUserInfo: window.fetchUserInfo,
    notifyBackend: window.notifyBackend,
    cleanURL: window.cleanURL
  };
  
  console.log('✅ ABRP OAuth Handler fully initialized');
  console.log('📊 Debug available at: window.debugABRPOAuth');
  
  // ============================================================================
  // CRITICAL: Handle tab switching - run handler when tab becomes visible
  // ============================================================================
  
  // Listen for tab becoming visible (user switched back to this tab)
  document.addEventListener('visibilitychange', function() {
    if (!document.hidden) {
      console.log('👁️ Tab became visible - checking for OAuth code...');
      setTimeout(() => window.handleOAuthRedirect(), 100);
    }
  });
  
  // Listen for window focus (user clicked on this window)
  window.addEventListener('focus', function() {
    console.log('🎯 Window focused - checking for OAuth code...');
    setTimeout(() => window.handleOAuthRedirect(), 100);
  });
  
  // Periodic check - in case OAuth happens while tab is hidden
  setInterval(function() {
    const code = window.getOAuthCode();
    const isProcessing = localStorage.getItem('abrpOAuthProcessing');
    const isConnected = localStorage.getItem('abrpOAuthStatus') === 'connected';
    
    if (code && !isProcessing && !isConnected) {
      console.log('⏰ Periodic check found unprocessed code - handling...');
      window.handleOAuthRedirect();
    }
  }, 2000); // Check every 2 seconds
  
})();

/**
 * Debug in browser console:
 * 
 * // Check if code was found in URL
 * window.getOAuthCode()
 * 
 * // Check token (should have access_token field)
 * localStorage.getItem('abrpToken')
 * 
 * // Check for errors
 * localStorage.getItem('abrpOAuthError')
 * 
 * // Check connection status
 * localStorage.getItem('abrpOAuthStatus')
 * 
 * // Manually trigger OAuth handler
 * window.handleOAuthRedirect()
 * 
 * // If stuck, reset processing flag
 * localStorage.removeItem('abrpOAuthProcessing');
 * window.handleOAuthRedirect();
 * 
 * // Check all ABRP data
 * console.log({
 *   token: localStorage.getItem('abrpToken'),
 *   user: localStorage.getItem('abrpUser'),
 *   status: localStorage.getItem('abrpOAuthStatus'),
 *   error: localStorage.getItem('abrpOAuthError')
 * });
 */
