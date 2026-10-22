/** Privacy Policy section 2, part two: what your device and the app send us. */
export function DeviceDataList() {
  return (
    <ul>
      <li>
        <strong className="text-white">Precise device location:</strong> If you open the map and grant permission, we
        read your device&apos;s GPS location to centre the map and show skate spots near you. That live map position
        stays on your device. When you tap Check in, we send one location reading to our servers to confirm you are at
        the spot. If you are offline, the check-in, with that reading, waits on your device until it can be sent. For
        each check-in we keep the spot, the exact time, and the GPS accuracy in your private check-in history (only you
        can read it). We also keep your most recent check-in coordinates and time, and (while you stay checked in) your
        most recent presence coordinates and time, on a private anti-spoofing record that only you and our servers can
        read. Those coordinates are replaced each time and are used only to stop faked check-ins. If a check-in looks
        faked (a mock-location app, or two spots too far apart to travel between), we record a strike on that record and
        may pause check-in rewards for a while. While you are checked in, the app re-checks every so often that you are
        still at the spot and writes a short &quot;here until&quot; record for that spot (your username and an expiry
        time). Any signed-in user can read that here-until record. Who&apos;s skating also shows the spot name and the
        exact time you were last seen there to other signed-in users, unless you turn on Hide my online status. Hide my
        online status clears the public last-seen time and keeps you out of Who&apos;s skating; it does not hide the
        here-until record at the spot itself or your check-in history. Separately, we store a last-seen server time on
        your online status (readable by signed-in users) when Hide my online status is off. Your spot passport and
        badges show the spot and the month or day, never your coordinates. You can revoke location permission at any
        time in your device or browser settings.
      </li>
      <li>
        <strong className="text-white">Push notification tokens:</strong> If you turn on notifications, we store your
        device&apos;s push token and a platform tag (web, iPhone or Android), and deliver notifications through Firebase
        Cloud Messaging and, on iPhone, Apple Push Notification service. So that other players&apos; game moves can
        alert you, a copy of the token can be looked up by signed-in users who know your account ID. Turning
        notifications off removes that copy and stops notifications; the token stays in the private part of your profile
        (only you can read it) until you sign out. Signing out removes the token.
      </li>
      <li>
        <strong className="text-white">Stored on your device:</strong> Your consent choice, your Hide my online status
        setting, the spot you are checked into, check-ins waiting to send while offline (including their location
        reading), a 24-hour block on sign-up after a birth date under 13 is entered, and display preferences.
      </li>
      <li>
        <strong className="text-white">Device checks:</strong> To stop automated abuse, we may use Firebase App Check,
        which asks Google reCAPTCHA v3 (on the web), Apple App Attest or DeviceCheck (on iPhone), or Google Play
        Integrity (on Android) to confirm that requests come from our real app. These services receive signals about
        your device or browser.
      </li>
      <li>
        <strong className="text-white">Usage data (only if you accept the consent banner):</strong> Product-usage events
        (e.g. game created, sign-in method, screens viewed) collected via PostHog, and page-view and loading-speed
        metrics collected via Vercel Analytics and Vercel Speed Insights. PostHog events are tied to a pseudonymous ID
        made from your account ID, never your email or username.
      </li>
      <li>
        <strong className="text-white">Error data:</strong> Crash reports and stack traces collected via Sentry, tied to
        the same pseudonymous ID. Email addresses and other direct identifiers are removed before sending.
      </li>
    </ul>
  );
}
