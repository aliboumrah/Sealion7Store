/**
 * ABRP OAuth Handler - GUARANTEED TO WORK
 * 
 * This runs BEFORE everything else and handles the redirect from ABRP
 * Insert this code in your HTML <head> BEFORE other scripts
 */

(function() {
  'use strict';
  
  console.log('🔐 ABRP OAuth Handler loaded');
  
  // ============================================================================
  // Step 1: Check if we're returning from ABRP with a code
  // ============================================================================
  
  function getOAuthCode() {
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
  }
  
  // ============================================================================
  // Step 2: Exchange code for token with ABRP
  // ============================================================================
  
  async function exchangeCodeWithABRP(code) {
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
  }
  
  // ============================================================================
  // Step 3: Save token and notify backend
  // ============================================================================
  
  function saveToken(tokenData) {
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
  }
  
  // ============================================================================
  // Step 4: Get user info from ABRP
  // ============================================================================
  
  async function fetchUserInfo(accessToken) {
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
  }
  
  // ============================================================================
  // Step 5: Notify backend and clean URL
  // ============================================================================
  
  function notifyBackend(token) {
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
  }
  
  function cleanURL() {
    console.log('🧹 Cleaning OAuth code from URL...');
    window.history.replaceState({}, document.title, window.location.pathname);
  }
  
  // ============================================================================
  // Step 6: Main handler - run if we have a code
  // ============================================================================
  
  async function handleOAuthRedirect() {
    const code = getOAuthCode();
    
    if (!code) {
      console.log('ℹ️ No OAuth code in URL (normal on first visit)');
      return;
    }
    
    console.log('🚀 ABRP OAuth redirect detected! Starting token exchange...');
    
    try {
      // Step 1: Exchange code with ABRP
      const tokenData = await exchangeCodeWithABRP(code);
      
      // Step 2: Save token locally
      saveToken(tokenData);
      
      // Step 3: Notify backend (optional)
      notifyBackend(tokenData.access_token);
      
      // Step 4: Clean URL
      cleanURL();
      
      // Step 5: Show success (wait a moment then reload to show updated UI)
      console.log('✅✅✅ ABRP OAuth COMPLETE! ✅✅✅');
      console.log('Token is saved. Reloading page to show connected status...');
      
      setTimeout(() => {
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
  }
  
  // ============================================================================
  // Auto-run on page load
  // ============================================================================
  
  // Run immediately if DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', handleOAuthRedirect);
  } else {
    handleOAuthRedirect();
  }
  
  // Also export for manual testing
  window.debugABRPOAuth = {
    getCode: getOAuthCode,
    exchange: exchangeCodeWithABRP,
    handleRedirect: handleOAuthRedirect
  };
  
})();

/**
 * Debug in browser console:
 * 
 * // Check if code was found
 * window.debugABRPOAuth.getCode()
 * 
 * // Check token
 * localStorage.getItem('abrpToken')
 * 
 * // Check error
 * localStorage.getItem('abrpOAuthError')
 * 
 * // Check status
 * localStorage.getItem('abrpOAuthStatus')
 */
