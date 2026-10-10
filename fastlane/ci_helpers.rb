# Pure helpers for the iOS CI lanes. No fastlane dependency, so
# `ruby fastlane/ci_helpers_test.rb` can run without Apple credentials.
require "base64"
require "json"
require "xcodeproj"

module SkatehubbaCI
  APP_IDENTIFIER = "com.skatehubba.app"
  # App Store Connect app Apple ID (App Information), not an account email.
  ASC_APP_ID = "6821392195"
  PROFILE_NAME = "match AppStore com.skatehubba.app"
  DEFAULT_MATCH_GIT_URL = "https://github.com/myhuemungusD/skatehubba-certs.git"
  MATCH_GIT_BRANCH = "main"
  GOOGLE_SERVICE_PLIST = "ios/App/App/GoogleService-Info.plist"
  VERSION_PATTERN = /\A\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?\z/

  # ASC_KEY_P8 may be the .p8 text (real newlines or the two characters \n)
  # or the base64 of that text. Returns the PEM. Never includes the key in
  # an error message.
  def self.decode_p8(raw)
    text = raw.to_s.gsub("\r\n", "\n").gsub("\\n", "\n").strip
    raise ArgumentError, "ASC_KEY_P8 is empty" if text.empty?

    pem = text.include?("PRIVATE KEY") ? text : Base64.decode64(text)
    unless pem.include?("PRIVATE KEY")
      raise ArgumentError, "ASC_KEY_P8 is not a .p8 private key. Paste the file or its base64."
    end
    pem.force_encoding("UTF-8")
  end

  # Blank override uses package.json. A single leading "v" is stripped so
  # a tag-shaped input (v1.2.3) and package.json (1.2.3) both work.
  def self.marketing_version(override, package_json_path)
    raw = override.to_s.strip
    raw = raw[1..] if raw.match?(/\Av\d/)
    if raw.empty?
      raw = JSON.parse(File.read(package_json_path)).fetch("version").to_s.strip
    end
    unless raw.match?(VERSION_PATTERN)
      raise ArgumentError, "version must look like 1.2.3"
    end
    raw
  end

  # `latest` is the build number fastlane already found (0 when that
  # version has no TestFlight upload yet). The next upload is one higher.
  def self.next_build_number(latest)
    text = latest.to_s
    unless text.match?(/\A\d+\z/)
      raise ArgumentError, "latest TestFlight build number must be a whole number"
    end
    text.to_i + 1
  end

  def self.match_git_url(env = ENV)
    configured = env["MATCH_GIT_URL"].to_s.strip
    url = configured.empty? ? DEFAULT_MATCH_GIT_URL : configured
    if url.include?("@") || !url.start_with?("https://")
      raise ArgumentError, "MATCH_GIT_URL must be an https URL with no token in it. Put the token in MATCH_GIT_BASIC_AUTHORIZATION."
    end
    url
  end

  def self.reversed_client_id(plist_xml)
    match = plist_xml.to_s.match(%r{<key>REVERSED_CLIENT_ID</key>\s*<string>([^<]+)</string>}m)
    return nil if match.nil?

    value = match[1].strip
    return nil if value.empty?
    return nil if value.match?(/[\s<>"']/) || value.include?("://")

    value
  end

  # Append the Google sign-in scheme. Leave every scheme that is already
  # there (the skatehubba:// link) in place.
  def self.ensure_url_scheme(types, scheme)
    entries = types.is_a?(Array) ? types.dup : []
    schemes = entries.flat_map { |entry| Array(entry["CFBundleURLSchemes"]) }
    return entries if schemes.include?(scheme)

    entries + [{
      "CFBundleURLName" => "google-sign-in",
      "CFBundleURLSchemes" => [scheme],
    }]
  end

  # Add GoogleService-Info.plist to the App target's Copy Bundle Resources
  # phase when the file is on disk. Idempotent. The simulator job never
  # calls this, and the plist stays gitignored.
  def self.attach_google_service_plist!(project_path, plist_filename = "GoogleService-Info.plist")
    project = Xcodeproj::Project.open(project_path)
    target = project.targets.find { |candidate| candidate.name == "App" }
    raise ArgumentError, "App target not found" if target.nil?

    group = project.main_group.children.find do |child|
      child.respond_to?(:path) && (child.path == "App" || child.display_name == "App")
    end
    raise ArgumentError, "App group not found" if group.nil?

    ref = group.files.find { |file| file.path == plist_filename }
    if ref.nil?
      ref = group.new_reference(plist_filename)
      ref.last_known_file_type = "text.plist.xml"
    end
    phase = target.resources_build_phase
    already = phase.files.any? { |build_file| build_file.file_ref == ref }
    phase.add_file_reference(ref) unless already
    project.save
  end
end
