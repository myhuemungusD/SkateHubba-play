# frozen_string_literal: true

require "fileutils"
require "minitest/autorun"
require "tmpdir"
require_relative "ci_helpers"

class SkatehubbaCITest < Minitest::Test
  PEM = "-----BEGIN PRIVATE KEY-----\ndGVzdA==\n-----END PRIVATE KEY-----\n"

  def test_decode_p8_raw_pem
    assert_equal PEM.strip, SkatehubbaCI.decode_p8(PEM)
  end

  def test_decode_p8_literal_newlines
    one_line = PEM.strip.gsub("\n", "\\n")
    assert_includes SkatehubbaCI.decode_p8(one_line), "BEGIN PRIVATE KEY"
    refute_includes SkatehubbaCI.decode_p8(one_line), "\\n"
  end

  def test_decode_p8_base64
    encoded = [PEM].pack("m0")
    assert_includes SkatehubbaCI.decode_p8(encoded), "BEGIN PRIVATE KEY"
  end

  def test_decode_p8_rejects_empty_and_garbage
    assert_raises(ArgumentError) { SkatehubbaCI.decode_p8("  ") }
    assert_raises(ArgumentError) { SkatehubbaCI.decode_p8("not-a-key") }
    error = assert_raises(ArgumentError) { SkatehubbaCI.decode_p8("not-a-key") }
    refute_includes error.message, "not-a-key"
  end

  def test_marketing_version_from_package_json
    Dir.mktmpdir do |dir|
      path = File.join(dir, "package.json")
      File.write(path, %({"version":"1.4.2"}\n))
      assert_equal "1.4.2", SkatehubbaCI.marketing_version("  ", path)
      assert_equal "2.0.0", SkatehubbaCI.marketing_version("v2.0.0", path)
      assert_equal "2.0.1-rc.1", SkatehubbaCI.marketing_version("2.0.1-rc.1", path)
    end
  end

  def test_marketing_version_rejects_blank_and_junk
    Dir.mktmpdir do |dir|
      path = File.join(dir, "package.json")
      File.write(path, %({"version":""}\n))
      assert_raises(ArgumentError) { SkatehubbaCI.marketing_version("", path) }
      File.write(path, %({"version":"1.1.0"}\n))
      assert_raises(ArgumentError) { SkatehubbaCI.marketing_version("latest", path) }
      assert_raises(ArgumentError) { SkatehubbaCI.marketing_version("1.2", path) }
    end
  end

  def test_repo_package_version_is_a_store_version
    path = File.expand_path("../package.json", __dir__)
    version = SkatehubbaCI.marketing_version("", path)
    assert_match SkatehubbaCI::VERSION_PATTERN, version
  end

  def test_next_build_number
    assert_equal 1, SkatehubbaCI.next_build_number(0)
    assert_equal 1, SkatehubbaCI.next_build_number("0")
    assert_equal 8, SkatehubbaCI.next_build_number(7)
    assert_equal 202610101431, SkatehubbaCI.next_build_number("202610101430")
    assert_raises(ArgumentError) { SkatehubbaCI.next_build_number(-1) }
  end

  def test_match_git_url_defaults_and_rejects_tokens
    assert_equal SkatehubbaCI::DEFAULT_MATCH_GIT_URL, SkatehubbaCI.match_git_url({})
    custom = "https://github.com/example/certs.git"
    assert_equal custom, SkatehubbaCI.match_git_url({ "MATCH_GIT_URL" => custom })
    assert_raises(ArgumentError) do
      SkatehubbaCI.match_git_url({ "MATCH_GIT_URL" => "https://user:token@github.com/example/certs.git" })
    end
    assert_raises(ArgumentError) do
      SkatehubbaCI.match_git_url({ "MATCH_GIT_URL" => "git@github.com:example/certs.git" })
    end
  end

  def test_url_scheme_keeps_skatehubba_and_is_idempotent
    xml = <<~XML
      <plist><dict>
        <key>REVERSED_CLIENT_ID</key>
        <string>com.googleusercontent.apps.example</string>
      </dict></plist>
    XML
    scheme = SkatehubbaCI.reversed_client_id(xml)
    assert_equal "com.googleusercontent.apps.example", scheme
    existing = [{ "CFBundleURLSchemes" => ["skatehubba"] }]
    once = SkatehubbaCI.ensure_url_scheme(existing, scheme)
    assert_equal ["skatehubba"], once[0]["CFBundleURLSchemes"]
    assert_equal [scheme], once[1]["CFBundleURLSchemes"]
    twice = SkatehubbaCI.ensure_url_scheme(once, scheme)
    assert_equal 2, twice.length
    assert_nil SkatehubbaCI.reversed_client_id("<plist></plist>")
    assert_nil SkatehubbaCI.reversed_client_id("<key>REVERSED_CLIENT_ID</key><string>has space</string>")
  end

  def test_attach_plist_is_idempotent_and_relative
    src = File.expand_path("../ios/App/App.xcodeproj", __dir__)
    Dir.mktmpdir do |dir|
      dest_project = File.join(dir, "App.xcodeproj")
      FileUtils.cp_r(src, dest_project)
      SkatehubbaCI.attach_google_service_plist!(dest_project)
      once = File.read(File.join(dest_project, "project.pbxproj"))
      SkatehubbaCI.attach_google_service_plist!(dest_project)
      twice = File.read(File.join(dest_project, "project.pbxproj"))
      assert_equal once, twice
      assert_includes twice, "GoogleService-Info.plist"
      refute_includes twice, dir
      # One build-file entry. The phrase also appears on the resources-phase
      # line, so a raw scan of the phrase is not the count of copies.
      assert_equal 1, twice.scan(/PBXBuildFile; fileRef = [A-F0-9]+ \/\* GoogleService-Info\.plist \*\//).length
      assert_includes twice, "PrivacyInfo.xcprivacy in Resources"
    end
  end

  def test_workflows_use_api_key_secrets_and_readonly_match
    root = File.expand_path("..", __dir__)
    release = File.read(File.join(root, ".github/workflows/ios-release.yml"))
    bootstrap = File.read(File.join(root, ".github/workflows/ios-signing-bootstrap.yml"))
    fastfile = File.read(File.join(root, "fastlane/Fastfile"))
    %w[ASC_KEY_ID ASC_ISSUER_ID ASC_KEY_P8 MATCH_PASSWORD MATCH_GIT_BASIC_AUTHORIZATION APPLE_TEAM_ID].each do |name|
      assert_includes release, name
      assert_includes bootstrap, name
    end
    refute_includes release, "APP_STORE_CONNECT_API_KEY"
    refute_includes bootstrap, "APP_STORE_CONNECT_API_KEY"
    assert_includes release, 'MATCH_READONLY: "true"'
    assert_includes bootstrap, 'MATCH_READONLY: "false"'
    assert_includes fastfile, "pilot("
    assert_includes fastfile, "skip_waiting_for_build_processing: true"
    assert_includes fastfile, "latest_testflight_build_number("
    refute_includes fastfile, "APPLE_ID"
  end
end
