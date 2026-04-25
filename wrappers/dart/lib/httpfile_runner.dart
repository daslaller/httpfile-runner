import 'dart:convert';
import 'dart:io';
import 'package:path/path.dart' as p;

enum RequestStatus { passed, failed, error, skipped }

class RequestResult {
  final String name;
  final String? file;
  final RequestStatus status;
  final int duration;
  final int? statusCode;
  final String? message;

  const RequestResult({
    required this.name,
    this.file,
    required this.status,
    required this.duration,
    this.statusCode,
    this.message,
  });

  bool get passed  => status == RequestStatus.passed;
  bool get failed  => status == RequestStatus.failed || status == RequestStatus.error;

  @override
  String toString() =>
      '${passed ? '✓' : '✗'} $name (${duration}ms)${message != null ? ': $message' : ''}';
}

class RunResult {
  final int exitCode;
  final List<RequestResult> requests;
  final int passed;
  final int failed;
  final int total;
  final String stdout;
  final String stderr;

  const RunResult({
    required this.exitCode,
    required this.requests,
    required this.passed,
    required this.failed,
    required this.total,
    required this.stdout,
    required this.stderr,
  });

  void printSummary() {
    print('\nijhttp run — $total request(s), $passed passed, $failed failed\n');
    for (final r in requests) {
      final icon = r.status == RequestStatus.passed  ? '✓'
                 : r.status == RequestStatus.skipped ? '—'
                 : '✗';
      print('  $icon ${r.name} (${r.duration}ms)');
      if (r.message != null) print('      ${r.message}');
    }
    print('');
  }
}

class RunOptions {
  final List<String> files;
  final String? env;
  final String? envFile;
  final String? privateEnvFile;
  final Map<String, String> variables;
  final String? report;
  final String logLevel;
  final String? ijhttpPath;
  final Duration? timeout;

  const RunOptions({
    required this.files,
    this.env,
    this.envFile,
    this.privateEnvFile,
    this.variables = const {},
    this.report,
    this.logLevel = 'BASIC',
    this.ijhttpPath,
    this.timeout,
  });
}

class HttpfileRunner {
  static String get _defaultIjhttp {
    final dir = p.dirname(Platform.script.toFilePath());
    final bin = Platform.isWindows ? 'ijhttp.bat' : 'ijhttp';
    return p.join(dir, '..', '..', '..', 'ijhttp', bin);
  }

  static Future<RunResult> run(RunOptions options) async {
    if (options.files.isEmpty) {
      throw ArgumentError('run() requires at least one .http file path');
    }

    final ijhttp    = options.ijhttpPath ?? _defaultIjhttp;
    final reportDir = options.report ?? await _makeTempDir();
    final useTemp   = options.report == null;

    final args = _buildArgs(options, reportDir);

    try {
      final proc = await Process.start(ijhttp, args, runInShell: Platform.isWindows);

      if (options.timeout != null) {
        Future.delayed(options.timeout!, () => proc.kill());
      }

      final stdoutBuf = StringBuffer();
      final stderrBuf = StringBuffer();

      await Future.wait([
        proc.stdout.transform(utf8.decoder).forEach(stdoutBuf.write),
        proc.stderr.transform(utf8.decoder).forEach(stderrBuf.write),
      ]);

      final exitCode = await proc.exitCode;
      final stdout   = stdoutBuf.toString();
      final stderr   = stderrBuf.toString();

      List<RequestResult> requests;
      try {
        requests = await _readReportDir(reportDir);
      } catch (_) {
        requests = _parseStdout(stdout);
      } finally {
        if (useTemp) Directory(reportDir).deleteSync(recursive: true);
      }

      final passed = requests.where((r) => r.status == RequestStatus.passed).length;
      final failed = requests.where((r) => r.failed).length;

      return RunResult(
        exitCode: exitCode,
        requests: requests,
        passed:   passed,
        failed:   failed,
        total:    requests.length,
        stdout:   stdout,
        stderr:   stderr,
      );
    } finally {
      if (useTemp) {
        try { Directory(reportDir).deleteSync(recursive: true); } catch (_) {}
      }
    }
  }

  static List<String> _buildArgs(RunOptions opts, String reportDir) {
    final args = <String>[];
    if (opts.env != null)            args.addAll(['--env',              opts.env!]);
    if (opts.envFile != null)        args.addAll(['--env-file',         opts.envFile!]);
    if (opts.privateEnvFile != null) args.addAll(['--private-env-file', opts.privateEnvFile!]);
    args.addAll(['--log-level', opts.logLevel]);
    args.addAll(['--report',    reportDir]);
    for (final e in opts.variables.entries) args.addAll(['-D', '${e.key}=${e.value}']);
    args.addAll(opts.files);
    return args;
  }

  static Future<String> _makeTempDir() async {
    final tmp = await Directory.systemTemp.createTemp('ijhttp-');
    return tmp.path;
  }

  static Future<List<RequestResult>> _readReportDir(String dir) async {
    final xmlFiles = Directory(dir)
        .listSync()
        .whereType<File>()
        .where((f) => f.path.endsWith('.xml'))
        .toList();

    if (xmlFiles.isEmpty) throw Exception('No XML report files found');

    return xmlFiles.expand((f) => _parseReport(f.readAsStringSync())).toList();
  }

  static List<RequestResult> _parseReport(String xml) {
    final results  = <RequestResult>[];
    final re       = RegExp(r'<testcase\s(.*?)>([\s\S]*?)<\/testcase>|<testcase\s(.*?)\/>');

    for (final m in re.allMatches(xml)) {
      final attrs   = m.group(1) ?? m.group(3) ?? '';
      final body    = m.group(2) ?? '';
      final name    = _attr(attrs, 'name')      ?? 'Unknown';
      final cls     = _attr(attrs, 'classname') ?? '';
      final timeSec = double.tryParse(_attr(attrs, 'time') ?? '0') ?? 0;

      final failMsg = _childMessage(body, 'failure');
      final errMsg  = _childMessage(body, 'error');
      final skipMsg = _childMessage(body, 'skipped');

      final status = failMsg != null ? RequestStatus.failed
                   : errMsg  != null ? RequestStatus.error
                   : skipMsg != null ? RequestStatus.skipped
                   : RequestStatus.passed;

      results.add(RequestResult(
        name:     name,
        file:     cls,
        status:   status,
        duration: (timeSec * 1000).round(),
        message:  failMsg ?? errMsg,
      ));
    }

    return results;
  }

  static List<RequestResult> _parseStdout(String stdout) {
    final results = <RequestResult>[];
    RequestResult? current;
    int? currentStart;

    for (final line in stdout.split(RegExp(r'\r?\n'))) {
      final reqMatch = RegExp(r'^###\s+(.+?)(?:\s+\(line\s+\d+\))?\s*$').firstMatch(line);
      if (reqMatch != null) {
        if (current != null) results.add(current);
        current = RequestResult(name: reqMatch.group(1)!.trim(), status: RequestStatus.passed, duration: 0);
        currentStart = DateTime.now().millisecondsSinceEpoch;
        continue;
      }
      if (current == null) continue;

      final resMatch = RegExp(r'Response code:\s*(\d+);\s*Time:\s*(\d+)ms').firstMatch(line);
      if (resMatch != null) {
        final code = int.parse(resMatch.group(1)!);
        final dur  = int.parse(resMatch.group(2)!);
        current = RequestResult(
          name:       current.name,
          file:       current.file,
          status:     code >= 400 ? RequestStatus.failed : RequestStatus.passed,
          statusCode: code,
          duration:   dur,
        );
      }
    }

    if (current != null) results.add(current);
    return results;
  }

  static String? _attr(String attrs, String name) {
    final m = RegExp('$name="([^"]*)"').firstMatch(attrs);
    return m?.group(1);
  }

  static String? _childMessage(String body, String tag) {
    final self   = RegExp('<$tag[^>]*message="([^"]*)"[^>]*/>').firstMatch(body);
    final open   = RegExp('<$tag[^>]*message="([^"]*)"[^>]*>').firstMatch(body);
    final noAttr = RegExp('<$tag[^>]*>([\\s\\S]*?)<\\/$tag>').firstMatch(body);
    if (self   != null) return self.group(1)!.trim();
    if (open   != null) return open.group(1)!.trim();
    if (noAttr != null) return noAttr.group(1)!.trim();
    if (body.contains('<$tag')) return '';
    return null;
  }
}
