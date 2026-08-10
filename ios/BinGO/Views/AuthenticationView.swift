import SwiftUI

struct AuthenticationView: View {
    @Environment(AppState.self) private var appState
    @State private var mode = "login"
    @State private var inviteCode = "welcome"
    @State private var username = ""
    @State private var password = ""
    @State private var errorMessage: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Picker("账号操作", selection: $mode) {
                Text("登录").tag("login")
                Text("邀请码注册").tag("register")
            }
            .pickerStyle(.segmented)
            if mode == "register" {
                TextField("组织邀请码", text: $inviteCode).textInputAutocapitalization(.never)
                TextField("用户名（同时作为昵称）", text: $username).textInputAutocapitalization(.never)
            } else {
                TextField("用户名", text: $username).textInputAutocapitalization(.never)
            }
            SecureField("密码（至少 10 位）", text: $password)
            if let errorMessage { Text(errorMessage).foregroundStyle(.red).font(.footnote) }
            Button(mode == "register" ? "注册并登录" : "登录") {
                Task { await submit() }
            }
            .buttonStyle(.borderedProminent)
            .disabled(appState.syncSession.isBusy || username.isEmpty || password.count < 10)
        }
    }

    private func submit() async {
        appState.syncSession.isBusy = true
        defer { appState.syncSession.isBusy = false }
        do {
            if mode == "register" {
                try await appState.syncSession.register(inviteCode: inviteCode, username: username, password: password)
            } else {
                try await appState.syncSession.login(identifier: username, password: password)
            }
            password = ""
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}
