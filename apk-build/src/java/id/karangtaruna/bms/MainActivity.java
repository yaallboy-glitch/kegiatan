package id.karangtaruna.bms;

import android.app.Activity;
import android.content.ContentValues;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.provider.MediaStore;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.webkit.CookieManager;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.io.OutputStream;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;

public class MainActivity extends Activity {
    private static final String HOST = "appassets.androidplatform.net";
    private static final String ORIGIN = "https://" + HOST;
    private static final int FILE_REQ = 4401;
    private static final String GOOGLE_CLIENT_ID = "358445361659-0in11rvmojoo00s4b0c92juegv8ra6iq.apps.googleusercontent.com";
    private static final String REDIRECT_URI = "com.googleusercontent.apps.358445361659-0in11rvmojoo00s4b0c92juegv8ra6iq:/oauth2redirect";

    private WebView web;
    private ValueCallback<Uri[]> filePathCb;
    private String codeVerifier;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        web = new WebView(this);
        setContentView(web);

        CookieManager cm = CookieManager.getInstance();
        cm.setAcceptCookie(true);
        cm.setAcceptThirdPartyCookies(web, true);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(true);
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(true);
        s.setTextZoom(100);

        web.addJavascriptInterface(new Bridge(), "Android");

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                filePathCb = callback;
                Intent i = new Intent(Intent.ACTION_GET_CONTENT);
                i.addCategory(Intent.CATEGORY_OPENABLE);
                i.setType("*/*");
                i.putExtra(Intent.EXTRA_MIME_TYPES, new String[]{"video/*", "image/*", "application/*", "text/*"});
                try { startActivityForResult(i, FILE_REQ); }
                catch (Exception e) { filePathCb = null; callback.onReceiveValue(null); return false; }
                return true;
            }
        });

        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest req) {
                Uri u = req.getUrl();
                if (!HOST.equals(u.getHost())) return null; // API/font/CDN = jaringan asli
                String path = u.getPath();
                if (path == null || path.isEmpty() || path.equals("/")) path = "/index.html";
                String asset = path.startsWith("/") ? path.substring(1) : path;
                try {
                    return new WebResourceResponse(mimeFor(path), "UTF-8", getAssets().open(asset));
                } catch (Exception e) {
                    try { return new WebResourceResponse("text/html", "UTF-8", getAssets().open("index.html")); }
                    catch (Exception e2) { return null; }
                }
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                String host = req.getUrl().getHost();
                if (host != null && host.equals(HOST)) return false; // aset app sendiri
                try { startActivity(new Intent(Intent.ACTION_VIEW, req.getUrl())); }
                catch (Exception ignored) {}
                return true;
            }
        });

        web.loadUrl(ORIGIN + "/index.html");
        handleOAuthIntent(getIntent());
    }

    @Override
    protected void onActivityResult(int req, int res, Intent data) {
        if (req == FILE_REQ && filePathCb != null) {
            filePathCb.onReceiveValue(res == RESULT_OK && data != null && data.getData() != null
                ? new Uri[]{data.getData()} : null);
            filePathCb = null;
        } else super.onActivityResult(req, res, data);
    }

    @Override
    public void onBackPressed() {
        if (web != null && web.canGoBack()) web.goBack(); else super.onBackPressed();
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleOAuthIntent(intent);
    }

    private void handleOAuthIntent(Intent intent) {
        if (intent == null) return;
        Uri u = intent.getData();
        if (u == null) return;
        String scheme = u.getScheme();
        if (scheme == null || !scheme.equals("com.googleusercontent.apps.358445361659-0in11rvmojoo00s4b0c92juegv8ra6iq")) return;
        String err = u.getQueryParameter("error");
        String code = u.getQueryParameter("code");
        if (err != null) { evalJs("window.__onGoogleError && window.__onGoogleError(" + jsq("Login dibatalkan (" + err + ")") + ")"); return; }
        if (code == null || code.isEmpty()) { evalJs("window.__onGoogleError && window.__onGoogleError(" + jsq("Kode otorisasi tidak diterima") + ")"); return; }
        final String authCode = code;
        new Thread(new Runnable() { @Override public void run() {
            try {
                String idToken = exchangeCode(authCode);
                if (idToken == null || idToken.isEmpty()) { evalJs("window.__onGoogleError && window.__onGoogleError(" + jsq("Gagal mendapatkan token") + ")"); return; }
                evalJs("if(window.__onGoogleIdToken){window.__onGoogleIdToken(" + jsq(idToken) + ")}");
            } catch (Exception e) {
                evalJs("window.__onGoogleError && window.__onGoogleError(" + jsq(e == null ? "Login gagal" : e.getMessage()) + ")");
            }
        } }).start();
    }

    private void evalJs(final String js) {
        runOnUiThread(new Runnable() { @Override public void run() { if (web != null) web.evaluateJavascript(js, null); } });
    }

    private void startGoogleLogin() {
        try {
            codeVerifier = genCodeVerifier();
            String challenge = genCodeChallenge(codeVerifier);
            String url = "https://accounts.google.com/o/oauth2/v2/auth"
                + "?client_id=" + enc(GOOGLE_CLIENT_ID)
                + "&redirect_uri=" + enc(REDIRECT_URI)
                + "&response_type=code"
                + "&scope=" + enc("openid email profile")
                + "&code_challenge=" + enc(challenge)
                + "&code_challenge_method=S256"
                + "&prompt=select_account";
            Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(i);
        } catch (Exception e) {
            evalJs("window.__onGoogleError && window.__onGoogleError(" + jsq(e.getMessage()) + ")");
        }
    }

    private static String enc(String s) throws Exception {
        return URLEncoder.encode(s, "UTF-8");
    }
    private static String jsq(String s) {
        if (s == null) s = "";
        return "'" + s.replace("\\", "\\\\").replace("'", "\\'").replace("\n", " ").replace("\r", " ") + "'";
    }
    private static String genCodeVerifier() {
        byte[] b = new byte[32];
        new SecureRandom().nextBytes(b);
        return base64Url(b);
    }
    private static String genCodeChallenge(String verifier) throws Exception {
        MessageDigest d = MessageDigest.getInstance("SHA-256");
        return base64Url(d.digest(verifier.getBytes(StandardCharsets.US_ASCII)));
    }
    private static String base64Url(byte[] b) {
        return Base64.encodeToString(b, Base64.URL_SAFE | Base64.NO_PADDING | Base64.NO_WRAP);
    }

    private String exchangeCode(String code) throws Exception {
        String verifier = codeVerifier;
        if (verifier == null) throw new Exception("Sesi login kedaluwarsa, coba lagi.");
        String body = "code=" + enc(code)
            + "&client_id=" + enc(GOOGLE_CLIENT_ID)
            + "&redirect_uri=" + enc(REDIRECT_URI)
            + "&grant_type=authorization_code"
            + "&code_verifier=" + enc(verifier);
        HttpURLConnection c = (HttpURLConnection) new URL("https://oauth2.googleapis.com/token").openConnection();
        c.setRequestMethod("POST");
        c.setDoOutput(true);
        c.setRequestProperty("Content-Type", "application/x-www-form-urlencoded");
        c.setConnectTimeout(15000);
        c.setReadTimeout(15000);
        java.io.OutputStream os = c.getOutputStream();
        os.write(body.getBytes(StandardCharsets.UTF_8));
        os.flush(); os.close();
        int rc = c.getResponseCode();
        java.io.InputStream is = (rc >= 200 && rc < 300) ? c.getInputStream() : c.getErrorStream();
        String resp = readAll(is);
        if (rc < 200 || rc >= 300) {
            String desc = extractJson(resp, "error_description");
            if (desc.isEmpty()) desc = extractJson(resp, "error");
            throw new Exception("Token error " + rc + (desc.isEmpty() ? "" : ": " + desc));
        }
        return extractJson(resp, "id_token");
    }
    private static String readAll(java.io.InputStream is) throws Exception {
        if (is == null) return "";
        BufferedReader r = new BufferedReader(new InputStreamReader(is, StandardCharsets.UTF_8));
        StringBuilder sb = new StringBuilder();
        String line;
        while ((line = r.readLine()) != null) sb.append(line);
        r.close();
        return sb.toString();
    }
    private static String extractJson(String json, String key) {
        try {
            int i = json.indexOf("\"" + key + "\"");
            if (i < 0) return "";
            int colon = json.indexOf(":", i);
            if (colon < 0) return "";
            int vq = json.indexOf("\"", colon);
            if (vq < 0) return "";
            int eq = json.indexOf("\"", vq + 1);
            if (eq < 0) return "";
            return json.substring(vq + 1, eq);
        } catch (Exception e) { return ""; }
    }

    private static String mimeFor(String p) {
        String l = p.toLowerCase();
        if (l.endsWith(".html") || l.endsWith("/")) return "text/html";
        if (l.endsWith(".css")) return "text/css";
        if (l.endsWith(".js")) return "application/javascript";
        if (l.endsWith(".json")) return "application/json";
        if (l.endsWith(".webmanifest")) return "application/manifest+json";
        if (l.endsWith(".png")) return "image/png";
        if (l.endsWith(".jpg") || l.endsWith(".jpeg")) return "image/jpeg";
        if (l.endsWith(".svg")) return "image/svg+xml";
        if (l.endsWith(".ico")) return "image/x-icon";
        if (l.endsWith(".txt")) return "text/plain";
        return "application/octet-stream";
    }

    public class Bridge {
        @JavascriptInterface
        public boolean isApp() { return true; }

        @JavascriptInterface
        public void loginGoogle() { runOnUiThread(new Runnable() { @Override public void run() { startGoogleLogin(); } }); }

        @JavascriptInterface
        public boolean saveBase64(String name, String b64) {
            try {
                byte[] data = Base64.decode(b64, Base64.DEFAULT);
                ContentValues cv = new ContentValues();
                cv.put(MediaStore.Downloads.DISPLAY_NAME, name == null || name.isEmpty() ? "download.bin" : name);
                cv.put(MediaStore.Downloads.MIME_TYPE, "application/octet-stream");
                cv.put(MediaStore.Downloads.IS_PENDING, 1);
                Uri uri = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, cv);
                if (uri == null) return false;
                OutputStream os = getContentResolver().openOutputStream(uri);
                if (os == null) return false;
                os.write(data);
                os.close();
                cv.clear();
                cv.put(MediaStore.Downloads.IS_PENDING, 0);
                getContentResolver().update(uri, cv, null, null);
                return true;
            } catch (Throwable t) {
                return false;
            }
        }
    }
}