"use client"

import { useState, useEffect, useRef } from "react"
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
  const [feetData, setFeetData] = useState<
    { timestamp: number; leftFoot: number; rightFoot: number; minHeight: number }[]
  >([])
  const [activeTab, setActiveTab] = useState("live")
  const [cameraFacingMode, setCameraFacingMode] = useState<"user" | "environment">("environment")

  // Refs for buffering graph data and tracking recording start time
  const graphBufferRef = useRef<
    { timestamp: number; leftFoot: number; rightFoot: number; minHeight: number }[]
  >([])
  const startTimeRef = useRef<number>(0)

  // Reset graph data and initialize buffer when recording starts
  useEffect(() => {
    if (isRecording) {
      setFeetData([])
      graphBufferRef.current = []
      startTimeRef.current = Date.now()
    }
  }, [isRecording])

  // Flush buffered graph data once per second
  useEffect(() => {
    if (isRecording) {
      const interval = setInterval(() => {
        if (graphBufferRef.current.length > 0) {
          setFeetData((prev) => [...prev, ...graphBufferRef.current])
          graphBufferRef.current = []
        }
      }, 1000)
      return () => clearInterval(interval)
    }
  }, [isRecording])

  // Modified callback to push data into buffer rather than updating state immediately
  const handleFeetHeightUpdate = (leftFoot: number, rightFoot: number) => {
    const minHeight =
      leftFoot !== 0 && rightFoot !== 0 ? Math.min(leftFoot, rightFoot) : Math.max(leftFoot, rightFoot)
    const timestamp = startTimeRef.current ? (Date.now() - startTimeRef.current) / 1000 : 0
    graphBufferRef.current.push({
      timestamp,
      leftFoot,
      rightFoot,
      minHeight,
    })
  }

  const toggleCamera = () => {
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
              <h1 className="text-3xl font-bold text-primary">VerticAi</h1>
              <p className="text-muted-foreground">Real-time live tracking and height analysis</p>
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
                <CardTitle>Jump Height Analysis</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-[400px] overflow-x-auto">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={feetData} margin={{ bottom: 30, right: 50 }}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis
                        dataKey="timestamp"
                        label={{ value: "Time (s)", position: "insideBottom", offset: -10 }}
                        type="number"
                        domain={['auto', 'auto']}
                        allowDataOverflow
                      />
                      <YAxis label={{ value: "Height (px)", angle: -90, position: "insideLeft" }} />
                      <Tooltip formatter={(value, name, props) => [`${value} px`, `${props.payload.timestamp.toFixed(2)} s`]} />
                      <Line type="monotone" dataKey="leftFoot" stroke="#3b82f6" name="Left Foot" strokeWidth={2} dot={false} />
                      <Line type="monotone" dataKey="rightFoot" stroke="#10b981" name="Right Foot" strokeWidth={2} dot={false} />
                      <Line type="monotone" dataKey="minHeight" stroke="#ef4444" name="Min Height" strokeWidth={2} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </main>
    </ThemeProvider>
  )
}
