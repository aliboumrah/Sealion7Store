/**
 * ABRP OAuth Handler - FULLY FIXED
 * 
 * Fixes:
 * 1. Wait for DOM before accessing document
 * 2. Use backend for OAuth exchange (not direct ABRP call)
 * 3. Handle all error cases
 * 4. Prevent tab switching
 * 5. Proper error handling and logging
 */

console.log('🔐 ABRP OAuth Handler - Starting...');

// Ensure this runs in correct context
(function() {
  'use strict';
  
  console.log('🔐 ABRP OAuth Handler loaded');
  
  // ============================================================================
  // Configuration
  // ============================================================================
  
  // Change this to your actual backend URL
  const BACKEND_URL = 'http://192.168.1.15:3000';
  
  // ============================================================================
  // Step 1: Check if we're returning from ABRP with a code
  // ============================================================================
  
  window.getOAuthCode = function() {
    const url = window.location.href;
    console.log('🔍 Checking URL for OAuth code');
    
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
  // Step 2: Exchange code for token WITH BACKEND (not direct ABRP)
  // ============================================================================
  
  window.exchangeCodeWithBackend = async function(code) {
    console.log('🔄 Exchanging OAuth code with BACKEND...');
    
    try {
      // Call YOUR BACKEND to exchange code
      // Backend will call ABRP's OAuth endpoint
      const response = await fetch(BACKEND_URL + '/abrp-oauth-token?code=' + encodeURIComponent(code), {
        method: 'GET',
        headers: {
          'Accept': 'application/json'
        }
      });
      
      console.log('📡 Backend response status:', response.status);
      
      if (!response.ok) {
        const text = await response.text();
        console.error('Backend error response:', text.substring(0, 200));
        throw new Error('Backend returned ' + response.status + ': ' + text.substring(0, 100));
      }
      
      const data = await response.json();
      
      console.log('Response data:', JSON.stringify(data).substring(0, 100));
      
      if (data.error) {
        throw new Error(`Backend Error: ${data.error} - ${data.message || ''}`);
      }
      
      if (!data.access_token) {
        throw new Error('No access_token in backend response: ' + JSON.stringify(data));
      }
      
      console.log('✅ Successfully got access token from backend');
      return data;
      
    } catch (error) {
      console.error('❌ OAuth exchange failed:', error.message);
      throw error;
    }
  };
  
  // ============================================================================
  // Step 3: Save token
  // ============================================================================
  
  window.saveToken = function(tokenData) {
    console.log('💾 Saving token to localStorage...');
    
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
    
    // Save user info if available
    if (tokenData.user) {
      localStorage.setItem('abrpUser', JSON.stringify(tokenData.user));
      console.log('✅ User info saved:', tokenData.user.full_name);
    }
  };
  
  // ============================================================================
  // Step 4: Clean URL
  // ============================================================================
  
  window.cleanURL = function() {
    console.log('🧹 Cleaning OAuth code from URL...');
    window.history.replaceState({}, document.title, window.location.pathname);
  };
  
  // ============================================================================
  // Step 5: Main handler
  // ============================================================================
  
  window.handleOAuthRedirect = async function() {
    const code = window.getOAuthCode();
    
    if (!code) {
      console.log('ℹ️ No OAuth code in URL');
      return false;
    }
    
    // Prevent running twice
    if (localStorage.getItem('abrpOAuthProcessing')) {
      console.log('⏳ OAuth already processing, skipping...');
      return false;
    }
    
    localStorage.setItem('abrpOAuthProcessing', '1');
    
    console.log('🚀 ABRP OAuth redirect detected! Starting token exchange...');
    
    try {
      // Exchange with backend
      const tokenData = await window.exchangeCodeWithBackend(code);
      
      // Save token
      window.saveToken(tokenData);
      
      // Clean URL
      window.cleanURL();
      
      // Success!
      console.log('✅✅✅ ABRP OAuth COMPLETE! ✅✅✅');
      
      localStorage.removeItem('abrpOAuthProcessing');
      
      // Reload to show updated UI
      setTimeout(() => {
        window.location.reload();
      }, 1500);
      
      return true;
      
    } catch (error) {
      console.error('❌❌❌ ABRP OAuth FAILED ❌❌❌');
      console.error('Error:', error.message);
      
      localStorage.setItem('abrpOAuthError', error.message);
      localStorage.setItem('abrpOAuthStatus', 'failed');
      localStorage.removeItem('abrpOAuthProcessing');
      
      return false;
    }
  };
  
  // ============================================================================
  // Auto-run - wait for DOM first
  // ============================================================================
  
  function runHandler() {
    console.log('🔄 Running OAuth handler check...');
    window.handleOAuthRedirect();
  }
  
  // Wait for DOM to be ready
  if (document.readyState === 'loading') {
    console.log('⏳ Waiting for DOMContentLoaded...');
    document.addEventListener('DOMContentLoaded', runHandler);
  } else {
    console.log('✅ DOM already loaded, running handler');
    runHandler();
  }
  
  // ============================================================================
  // Handle tab visibility changes
  // ============================================================================
  
  // Only add these listeners AFTER dom is ready
  function addEventListeners() {
    if (!document) {
      console.warn('⚠️ Document not ready yet');
      setTimeout(addEventListeners, 100);
      return;
    }
    
    try {
      document.addEventListener('visibilitychange', function() {
        if (!document.hidden) {
          console.log('👁️ Tab became visible - checking for OAuth code...');
          setTimeout(() => window.handleOAuthRedirect(), 100);
        }
      });
      console.log('✅ Visibility listener added');
    } catch (e) {
      console.warn('⚠️ Could not add visibility listener:', e.message);
    }
  }
  
  // Add listeners when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', addEventListeners);
  } else {
    addEventListeners();
  }
  
  // Periodic check
  setInterval(function() {
    const code = window.getOAuthCode();
    const isProcessing = localStorage.getItem('abrpOAuthProcessing');
    const isConnected = localStorage.getItem('abrpOAuthStatus') === 'connected';
    
    if (code && !isProcessing && !isConnected) {
      console.log('⏰ Periodic check found unprocessed code - handling...');
      window.handleOAuthRedirect();
    }
  }, 2000);
  
  // Export debug functions
  window.debugABRPOAuth = {
    getCode: window.getOAuthCode,
    exchangeWithBackend: window.exchangeCodeWithBackend,
    handleRedirect: window.handleOAuthRedirect,
    saveToken: window.saveToken,
    cleanURL: window.cleanURL,
    backendUrl: BACKEND_URL
  };
  
  console.log('✅ ABRP OAuth Handler fully initialized');
  console.log('📊 Backend URL:', BACKEND_URL);
  console.log('📊 Debug available at: window.debugABRPOAuth');
  
})();

/**
 * Debug in browser console (F12):
 * 
 * // Check code
 * window.getOAuthCode()
 * 
 * // Check token
 * localStorage.getItem('abrpToken')
 * 
 * // Check error
 * localStorage.getItem('abrpOAuthError')
 * 
 * // Check status
 * localStorage.getItem('abrpOAuthStatus')
 * 
 * // Manually run handler
 * localStorage.removeItem('abrpOAuthProcessing');
 * window.handleOAuthRedirect();
 * 
 * // Check backend is reachable
 * fetch('http://192.168.1.15:3000/abrp/status')
 *   .then(r => r.json())
 *   .then(d => console.log(d));
 * 
 * // Check all data
 * console.log({
 *   code: window.getOAuthCode(),
 *   token: localStorage.getItem('abrpToken'),
 *   user: localStorage.getItem('abrpUser'),
 *   status: localStorage.getItem('abrpOAuthStatus'),
 *   error: localStorage.getItem('abrpOAuthError'),
 *   backend: window.debugABRPOAuth.backendUrl
 * });
 */
