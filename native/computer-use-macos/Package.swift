// swift-tools-version: 6.0

import PackageDescription

let package = Package(
    name: "KinguComputerUseMacOS",
    platforms: [
        .macOS(.v14)
    ],
    products: [
        .library(
            name: "KinguComputerUseMacOSCore",
            targets: ["KinguComputerUseMacOSCore"]
        ),
        .executable(
            name: "kingu-computer-use-macos",
            targets: ["KinguComputerUseMacOS"]
        )
    ],
    targets: [
        .target(
            name: "KinguComputerUseMacOSCore",
            path: "Sources/KinguComputerUseMacOSCore"
        ),
        .executableTarget(
            name: "KinguComputerUseMacOS",
            dependencies: ["KinguComputerUseMacOSCore"],
            path: "Sources/KinguComputerUseMacOS"
        ),
        .testTarget(
            name: "KinguComputerUseMacOSTests",
            dependencies: ["KinguComputerUseMacOSCore"],
            path: "Tests/KinguComputerUseMacOSTests"
        )
    ]
)
