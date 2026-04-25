import 'models.dart';

/// Parses an IntelliJ HTTP Client (.http) file into a list of [HttpRequest]s.
///
/// Handles:
/// - Named request separators (### Name)
/// - HTTP method + URL line
/// - Request headers
/// - Request body (after blank line)
/// - File-level variable declarations (@var = value)
///
/// Not yet implemented: variable substitution, pre/post scripts, multipart.
class HttpFileParser {
  static final _separatorRe    = RegExp(r'^###\s*(.*)$');
  static final _methodLineRe   = RegExp(r'^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|TRACE)\s+(\S+)');
  static final _headerRe       = RegExp(r'^([\w\-]+):\s*(.+)$');
  static final _variableDeclRe = RegExp(r'^@(\w+)\s*=\s*(.+)$');

  /// Parse raw .http file content into an [HttpFile].
  static HttpFile parse(String content, {String path = ''}) {
    final lines    = content.split(RegExp(r'\r?\n'));
    final requests = <HttpRequest>[];
    final fileVars = <String, String>{};

    _Block? current;

    void flush() {
      if (current == null) return;
      final req = _buildRequest(current!, fileVars);
      if (req != null) requests.add(req);
      current = null;
    }

    for (final line in lines) {
      // File-level variable declaration (before first ###)
      final varMatch = _variableDeclRe.firstMatch(line);
      if (varMatch != null && current == null) {
        fileVars[varMatch.group(1)!] = varMatch.group(2)!.trim();
        continue;
      }

      final sepMatch = _separatorRe.firstMatch(line);
      if (sepMatch != null) {
        flush();
        current = _Block(name: sepMatch.group(1)?.trim());
        continue;
      }

      if (current == null) {
        // Implicit first request block (no leading ###)
        if (_methodLineRe.hasMatch(line)) {
          current = _Block();
        } else {
          continue;
        }
      }

      current!.lines.add(line);
    }

    flush();
    return HttpFile(path: path, requests: requests);
  }

  static HttpRequest? _buildRequest(_Block block, Map<String, String> fileVars) {
    final lines = block.lines;
    if (lines.isEmpty) return null;

    String? method, url;
    final headers     = <String, String>{};
    final bodyLines   = <String>[];
    bool  inBody      = false;
    bool  foundMethod = false;

    for (final line in lines) {
      if (!foundMethod) {
        final m = _methodLineRe.firstMatch(line.trim());
        if (m != null) {
          method     = m.group(1);
          url        = m.group(2);
          foundMethod = true;
          continue;
        }
        // URL continuation line
        if (url != null && line.startsWith('  ')) {
          url = (url) + line.trim();
          continue;
        }
        continue;
      }

      if (!inBody) {
        if (line.trim().isEmpty) { inBody = true; continue; }
        final h = _headerRe.firstMatch(line);
        if (h != null) { headers[h.group(1)!] = h.group(2)!; continue; }
      } else {
        bodyLines.add(line);
      }
    }

    if (method == null || url == null) return null;

    return HttpRequest(
      name:    block.name,
      method:  method,
      url:     url,
      headers: headers,
      body:    bodyLines.isNotEmpty ? bodyLines.join('\n') : null,
    );
  }
}

class _Block {
  final String? name;
  final List<String> lines = [];
  _Block({this.name});
}
