export function POST() {
  return Response.json({
    code: "credential_operation_retired",
    error: "Staff can reset their own password from the sign-in page."
  }, {status: 410, headers: {"Cache-Control": "private, no-store"}});
}
