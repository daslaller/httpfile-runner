/// Data models for parsed .http file structures.

class HttpFile {
  final String path;
  final List<HttpRequest> requests;

  const HttpFile({required this.path, required this.requests});
}

class HttpRequest {
  final String? name;
  final String method;
  final String url;
  final Map<String, String> headers;
  final String? body;
  final List<String> preRequestScripts;
  final List<String> responseHandlers;

  const HttpRequest({
    this.name,
    required this.method,
    required this.url,
    this.headers = const {},
    this.body,
    this.preRequestScripts = const [],
    this.responseHandlers  = const [],
  });
}
