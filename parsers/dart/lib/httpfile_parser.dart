/// Native Dart parser for IntelliJ HTTP Client (.http) files.
///
/// This is the foundation for a future zero-dependency implementation —
/// no ijhttp CLI, no Java, no JVM. The goal is to parse and execute
/// .http files entirely within Dart, making it suitable for Flutter
/// testing, Dart CLI tools, and any Dart environment.
///
/// Current status: stub / work in progress.
/// Track progress: https://github.com/daslaller/httpfile-runner
library httpfile_parser;

export 'src/parser.dart';
export 'src/models.dart';
