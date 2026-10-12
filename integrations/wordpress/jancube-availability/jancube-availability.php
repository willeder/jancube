<?php
/**
 * Plugin Name:       雀CUBE 空き状況
 * Description:       雀CUBE 予約システムの空き状況ウィジェット（C-23）と予約ボタンをショートコードで表示します。
 * Version:           1.0.0
 * Requires at least: 6.0
 * Requires PHP:      7.4
 * Author:            Willeder
 * License:           GPL-2.0-or-later
 * Text Domain:       jancube-availability
 *
 * Shortcodes:
 *   [jancube_availability store="JC001" days="3" theme="light" height="360"]
 *   [jancube_booking_button store="JC001" label="ご予約はこちら"]
 * The base URL of the booking site is set in Settings > 雀CUBE 予約.
 */

if (!defined('ABSPATH')) {
	exit;
}

const JANCUBE_OPTION = 'jancube_availability_settings';
const JANCUBE_DEFAULT_BASE_URL = 'https://jancube.net';

/** Saved settings merged with defaults. */
function jancube_settings() {
	$saved = get_option(JANCUBE_OPTION, array());
	return wp_parse_args(
		is_array($saved) ? $saved : array(),
		array(
			'base_url' => JANCUBE_DEFAULT_BASE_URL,
			'days'     => 3,
			'theme'    => 'light',
			'height'   => 360,
		)
	);
}

/** Store codes are short ASCII identifiers (e.g. JC001); anything else is rejected. */
function jancube_store_code($value) {
	$code = trim((string) $value);
	return preg_match('/^[A-Za-z0-9_-]{1,32}$/', $code) ? $code : '';
}

function jancube_base_url() {
	return untrailingslashit(esc_url_raw(jancube_settings()['base_url'], array('https', 'http')));
}

/** [jancube_availability store="JC001" days="3" theme="light" height="360"] */
function jancube_availability_shortcode($atts) {
	$defaults = jancube_settings();
	$atts     = shortcode_atts(
		array(
			'store'  => '',
			'days'   => $defaults['days'],
			'theme'  => $defaults['theme'],
			'height' => $defaults['height'],
		),
		$atts,
		'jancube_availability'
	);
	$store = jancube_store_code($atts['store']);
	if ($store === '' || jancube_base_url() === '') {
		return current_user_can('edit_posts')
			? '<p>' . esc_html__('雀CUBE: store="JC001" のように店舗コードを指定してください。', 'jancube-availability') . '</p>'
			: '';
	}
	$days   = min(14, max(1, absint($atts['days'])));
	$theme  = $atts['theme'] === 'dark' ? 'dark' : 'light';
	$height = min(1200, max(200, absint($atts['height'])));
	$src    = add_query_arg(
		array('days' => $days, 'theme' => $theme),
		jancube_base_url() . '/embed/availability/' . rawurlencode($store)
	);

	wp_enqueue_script('jancube-availability');
	return sprintf(
		'<iframe class="jancube-availability" src="%1$s" title="%2$s" width="100%%" height="%3$d" style="border:0;max-width:100%%" loading="lazy"></iframe>',
		esc_url($src),
		esc_attr(sprintf('雀CUBE %s 空き状況', $store)),
		$height
	);
}
add_shortcode('jancube_availability', 'jancube_availability_shortcode');

/** [jancube_booking_button store="JC001" label="ご予約はこちら"] — plain link with UTM tags. */
function jancube_booking_button_shortcode($atts) {
	$atts  = shortcode_atts(
		array('store' => '', 'label' => 'ご予約はこちら'),
		$atts,
		'jancube_booking_button'
	);
	$store = jancube_store_code($atts['store']);
	if ($store === '' || jancube_base_url() === '') {
		return '';
	}
	$href = add_query_arg(
		array(
			'utm_source'   => 'website',
			'utm_medium'   => 'referral',
			'utm_campaign' => 'hp_button',
		),
		jancube_base_url() . '/booking/' . rawurlencode($store) . '/date'
	);
	return sprintf(
		'<a class="jancube-booking-button" href="%1$s" target="_blank" rel="noopener" style="display:inline-block;padding:12px 24px;border-radius:8px;background:#007140;color:#fff;font-weight:bold;text-decoration:none">%2$s</a>',
		esc_url($href),
		esc_html($atts['label'])
	);
}
add_shortcode('jancube_booking_button', 'jancube_booking_button_shortcode');

/**
 * Optional auto-height: the widget may post {type: 'jancube:resize', height} to the parent page.
 * Only messages from the configured booking site are accepted.
 */
function jancube_register_assets() {
	wp_register_script(
		'jancube-availability',
		plugins_url('assets/resize.js', __FILE__),
		array(),
		'1.0.0',
		true
	);
	wp_localize_script('jancube-availability', 'jancubeAvailability', array('origin' => jancube_origin()));
}
add_action('wp_enqueue_scripts', 'jancube_register_assets');

function jancube_origin() {
	$parts = wp_parse_url(jancube_base_url());
	if (empty($parts['scheme']) || empty($parts['host'])) {
		return '';
	}
	return $parts['scheme'] . '://' . $parts['host'] . (isset($parts['port']) ? ':' . $parts['port'] : '');
}

// ------------------------------------------------------------------ settings page

function jancube_sanitize_settings($input) {
	$input = is_array($input) ? $input : array();
	$url   = esc_url_raw(trim((string) ($input['base_url'] ?? '')), array('https', 'http'));
	return array(
		'base_url' => $url !== '' ? untrailingslashit($url) : JANCUBE_DEFAULT_BASE_URL,
		'days'     => min(14, max(1, absint($input['days'] ?? 3))),
		'theme'    => ($input['theme'] ?? '') === 'dark' ? 'dark' : 'light',
		'height'   => min(1200, max(200, absint($input['height'] ?? 360))),
	);
}

function jancube_admin_init() {
	register_setting(
		'jancube_availability',
		JANCUBE_OPTION,
		array('sanitize_callback' => 'jancube_sanitize_settings')
	);
}
add_action('admin_init', 'jancube_admin_init');

function jancube_admin_menu() {
	add_options_page(
		'雀CUBE 予約',
		'雀CUBE 予約',
		'manage_options',
		'jancube-availability',
		'jancube_settings_page'
	);
}
add_action('admin_menu', 'jancube_admin_menu');

function jancube_settings_page() {
	if (!current_user_can('manage_options')) {
		return;
	}
	$s = jancube_settings();
	?>
	<div class="wrap">
		<h1>雀CUBE 予約</h1>
		<form method="post" action="options.php">
			<?php settings_fields('jancube_availability'); ?>
			<table class="form-table" role="presentation">
				<tr>
					<th scope="row"><label for="jancube-base-url">予約サイトのURL</label></th>
					<td>
						<input id="jancube-base-url" class="regular-text" type="url"
							name="<?php echo esc_attr(JANCUBE_OPTION); ?>[base_url]"
							value="<?php echo esc_attr($s['base_url']); ?>" required>
						<p class="description">例: https://jancube.net（末尾の / は不要）</p>
					</td>
				</tr>
				<tr>
					<th scope="row"><label for="jancube-days">初期表示日数</label></th>
					<td>
						<input id="jancube-days" type="number" min="1" max="14"
							name="<?php echo esc_attr(JANCUBE_OPTION); ?>[days]"
							value="<?php echo esc_attr((string) $s['days']); ?>">
					</td>
				</tr>
				<tr>
					<th scope="row"><label for="jancube-theme">テーマ</label></th>
					<td>
						<select id="jancube-theme" name="<?php echo esc_attr(JANCUBE_OPTION); ?>[theme]">
							<option value="light" <?php selected($s['theme'], 'light'); ?>>ライト</option>
							<option value="dark" <?php selected($s['theme'], 'dark'); ?>>ダーク</option>
						</select>
					</td>
				</tr>
				<tr>
					<th scope="row"><label for="jancube-height">高さ(px)</label></th>
					<td>
						<input id="jancube-height" type="number" min="200" max="1200"
							name="<?php echo esc_attr(JANCUBE_OPTION); ?>[height]"
							value="<?php echo esc_attr((string) $s['height']); ?>">
					</td>
				</tr>
			</table>
			<?php submit_button(); ?>
		</form>
		<h2>使い方</h2>
		<p>固定ページや投稿に次のショートコードを貼り付けてください（店舗コードは管理画面「埋め込みコード」で確認できます）。</p>
		<p><code>[jancube_availability store="JC001"]</code> 空き状況</p>
		<p><code>[jancube_booking_button store="JC001" label="ご予約はこちら"]</code> 予約ボタン</p>
	</div>
	<?php
}
