"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts"
import VideoRecorder from "@/components/video-recorder"
import FeetTracker from "@/components/feet-tracker"
import { ThemeProvider } from "@/components/theme-provider"
import ThemeToggle from "@/components/theme-toggle"
import { FlipHorizontal } from "lucide-react"

export default function Home() {
  const [isRecording, setIsRecording] = useState(false)
  const [showTracking, setShowTracking] = useState(true)
  const [feetData, setFeetData] = useState<{ timestamp: number; leftFoot: number; rightFoot: number }[]>([])
  const [activeTab, setActiveTab] = useState("live")
  const [cameraFacingMode, setCameraFacingMode] = useState<"user" | "environment">("environment")

  // Clear data when starting a new recording
  useEffect(() => {
    if (isRecording) {
      setFeetData([])
    }
  }, [isRecording])

  // Handle new feet height data
  const handleFeetHeightUpdate = (leftFoot: number, rightFoot: number) => {
    setFeetData((prev) => {
      const newData = [
        ...prev,
        {
          timestamp: prev.length,
          leftFoot,
          rightFoot,
        },
      ]

      // Keep only the last 100 data points for performance
      if (newData.length > 100) {
        return newData.slice(newData.length - 100)
      }
      return newData
    })
  }

  // Toggle between front and back camera
  const toggleCamera = () => {
    // Stop recording when switching cameras
    if (isRecording) {
      setIsRecording(false)
    }

    setCameraFacingMode((prev) => (prev === "user" ? "environment" : "user"))
  }

  return (
    <ThemeProvider defaultTheme="dark" storageKey="vertical-ai-theme">
      <main className="min-h-screen bg-background p-4 md:p-8">
        <div className="container mx-auto max-w-7xl">
          <header className="flex justify-between items-center mb-8">
            <div>
              <h1 className="text-3xl font-bold text-primary">Vertical AI</h1>
              <p className="text-muted-foreground">Real-time feet tracking and height analysis</p>
            </div>
            <ThemeToggle />
          </header>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <Card className="lg:col-span-2">
              <CardHeader>
                <div className="flex justify-between items-center">
                  <CardTitle>Video Feed</CardTitle>
                  <div className="flex items-center space-x-4">
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={toggleCamera}
                      title={`Switch to ${cameraFacingMode === "user" ? "back" : "front"} camera`}
                    >
                      <FlipHorizontal className="h-4 w-4" />
                    </Button>
                    <div className="flex items-center space-x-2">
                      <Switch id="tracking-overlay" checked={showTracking} onCheckedChange={setShowTracking} />
                      <Label htmlFor="tracking-overlay">Tracking Overlay</Label>
                    </div>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="relative aspect-video bg-black rounded-md overflow-hidden">
                  {activeTab === "live" ? (
                    <FeetTracker
                      isRecording={isRecording}
                      showTracking={showTracking}
                      onFeetHeightUpdate={handleFeetHeightUpdate}
                      facingMode={cameraFacingMode}
                    />
                  ) : (
                    <VideoRecorder isRecording={isRecording} facingMode={cameraFacingMode} />
                  )}
                </div>
                <div className="flex justify-between mt-4">
                  <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
                    <TabsList className="grid w-full max-w-md grid-cols-2">
                      <TabsTrigger value="live">Live Analysis</TabsTrigger>
                      <TabsTrigger value="record">Record Video</TabsTrigger>
                    </TabsList>
                  </Tabs>
                  <Button
                    variant={isRecording ? "destructive" : "default"}
                    onClick={() => setIsRecording(!isRecording)}
                  >
                    {isRecording ? "Stop" : "Start"} {activeTab === "record" ? "Recording" : "Analysis"}
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Feet Height Analysis</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-[300px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={feetData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis
                        dataKey="timestamp"
                        label={{ value: "Frame", position: "insideBottomRight", offset: -5 }}
                      />
                      <YAxis label={{ value: "Height (px)", angle: -90, position: "insideLeft" }} />
                      <Tooltip />
                      <Line
                        type="monotone"
                        dataKey="leftFoot"
                        stroke="#3b82f6"
                        name="Left Foot"
                        strokeWidth={2}
                        dot={false}
                      />
                      <Line
                        type="monotone"
                        dataKey="rightFoot"
                        stroke="#10b981"
                        name="Right Foot"
                        strokeWidth={2}
                        dot={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                <div className="mt-4 space-y-2">
                  <div className="flex justify-between text-sm">
                    <div className="flex items-center">
                      <div className="w-3 h-3 rounded-full bg-blue-500 mr-2"></div>
                      <span>Left Foot</span>
                    </div>
                    <span className="font-medium">
                      {feetData.length > 0 ? `${feetData[feetData.length - 1].leftFoot.toFixed(1)} px` : "0 px"}
                    </span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <div className="flex items-center">
                      <div className="w-3 h-3 rounded-full bg-green-500 mr-2"></div>
                      <span>Right Foot</span>
                    </div>
                    <span className="font-medium">
                      {feetData.length > 0 ? `${feetData[feetData.length - 1].rightFoot.toFixed(1)} px` : "0 px"}
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="lg:col-span-3">
              <CardHeader>
                <CardTitle>Performance Metrics</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  <div className="bg-primary/10 p-4 rounded-lg">
                    <h3 className="text-lg font-medium mb-1">Max Height</h3>
                    <p className="text-3xl font-bold">
                      {feetData.length > 0
                        ? `${Math.max(...feetData.map((d) => Math.max(d.leftFoot, d.rightFoot))).toFixed(1)} px`
                        : "0 px"}
                    </p>
                  </div>
                  <div className="bg-primary/10 p-4 rounded-lg">
                    <h3 className="text-lg font-medium mb-1">Jump Count</h3>
                    <p className="text-3xl font-bold">
                      {isRecording && activeTab === "live"
                        ? document
                            .querySelector(".absolute.bottom-4 .flex:first-child span:first-child")
                            ?.textContent?.split(": ")[1] || "0"
                        : "0"}
                    </p>
                  </div>
                  <div className="bg-primary/10 p-4 rounded-lg">
                    <h3 className="text-lg font-medium mb-1">Flight Time</h3>
                    <p className="text-3xl font-bold">
                      {isRecording && activeTab === "live"
                        ? document
                            .querySelector(".absolute.bottom-4 .flex:last-child span:last-child")
                            ?.textContent?.split(": ")[1] || "0.00 s"
                        : "0.00 s"}
                    </p>
                  </div>
                  <div className="bg-primary/10 p-4 rounded-lg">
                    <h3 className="text-lg font-medium mb-1">Frame Rate</h3>
                    <p className="text-3xl font-bold">{isRecording ? "30 FPS" : "0 FPS"}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </main>
    </ThemeProvider>
  )
}

