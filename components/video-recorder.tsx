"use client"

import { useRef, useEffect, useState } from "react"

interface VideoRecorderProps {
  isRecording: boolean
  facingMode?: "user" | "environment"
}

export default function VideoRecorder({ isRecording, facingMode = "environment" }: VideoRecorderProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const [recordedChunks, setRecordedChunks] = useState<Blob[]>([])
  const [videoUrl, setVideoUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cameraLoading, setCameraLoading] = useState(true)
  const streamRef = useRef<MediaStream | null>(null)

  // Update camera when facingMode changes
  useEffect(() => {
    // Stop any existing stream
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop())
      streamRef.current = null
    }

    if (videoRef.current) {
      videoRef.current.srcObject = null
    }

    // Re-initialize camera with new facing mode
    setCameraLoading(true)
    setError(null)
    setupCamera()
  }, [facingMode])

  const setupCamera = async () => {
    setCameraLoading(true)
    setError(null)

    try {
      // Get user media with constraints that work well on mobile devices
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: facingMode, // Use specified camera
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30 }, // Lower framerate for better compatibility
        },
        audio: false,
      })

      // Store stream reference for cleanup
      streamRef.current = stream

      if (videoRef.current) {
        videoRef.current.srcObject = stream
        // Ensure video plays on iOS Safari
        videoRef.current.setAttribute("playsinline", "true")
        videoRef.current.setAttribute("webkit-playsinline", "true")

        // Ensure video plays when ready
        videoRef.current.onloadedmetadata = () => {
          videoRef.current?.play().catch((e) => {
            console.error("Error playing video:", e)
            setError("Could not play video. Please ensure you've granted camera permissions.")
          })
          setCameraLoading(false)
        }
      }
    } catch (err: any) {
      console.error("Error accessing camera:", err)
      setCameraLoading(false)

      // Provide user-friendly error messages
      if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
        setError("Camera access denied. Please allow camera access in your browser settings.")
      } else if (err.name === "NotFoundError" || err.name === "DevicesNotFoundError") {
        setError("No camera found. Please ensure your device has a camera.")
      } else if (err.name === "NotReadableError" || err.name === "TrackStartError") {
        setError("Camera is in use by another application or not accessible.")
      } else {
        setError(`Camera error: ${err.message || "Unknown error"}`)
      }
    }
  }

  useEffect(() => {
    setupCamera()

    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop())
        streamRef.current = null
      }
    }
  }, [facingMode])

  useEffect(() => {
    if (!videoRef.current?.srcObject || error) return

    if (isRecording) {
      startRecording()
    } else if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      stopRecording()
    }
  }, [isRecording, error])

  const startRecording = () => {
    setRecordedChunks([])
    setVideoUrl(null)

    if (videoRef.current?.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream

      // Check for MediaRecorder support and available MIME types
      const mimeType = getSupportedMimeType()

      try {
        const mediaRecorder = new MediaRecorder(stream, {
          mimeType: mimeType,
        })

        mediaRecorderRef.current = mediaRecorder

        mediaRecorder.ondataavailable = (event) => {
          if (event.data.size > 0) {
            setRecordedChunks((prev) => [...prev, event.data])
          }
        }

        mediaRecorder.onstop = () => {
          if (recordedChunks.length > 0) {
            const blob = new Blob(recordedChunks, {
              type: mimeType,
            })
            const url = URL.createObjectURL(blob)
            setVideoUrl(url)
          }
        }

        mediaRecorder.start(1000) // Collect data every second
      } catch (err) {
        console.error("Error starting MediaRecorder:", err)
        setError("Could not start recording. Your browser may not support this feature.")
      }
    }
  }

  const stopRecording = () => {
    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.stop()
    }
  }

  // Helper function to get supported MIME type for MediaRecorder
  const getSupportedMimeType = () => {
    const types = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm", "video/mp4"]

    for (const type of types) {
      if (MediaRecorder.isTypeSupported(type)) {
        return type
      }
    }

    return "video/webm" // Fallback
  }

  // Function to retry camera setup
  const retryCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop())
      streamRef.current = null
    }

    if (videoRef.current) {
      videoRef.current.srcObject = null
    }

    // Re-initialize camera
    setCameraLoading(true)
    setError(null)
    setupCamera()
  }

  return (
    <>
      <div className="relative w-full h-full">
        {!videoUrl ? (
          <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
        ) : (
          <video src={videoUrl} controls playsInline className="w-full h-full object-contain" />
        )}

        {cameraLoading && !videoUrl && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/50">
            <div className="text-white text-center">
              <div className="animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-white mx-auto mb-2"></div>
              <p>Initializing camera...</p>
            </div>
          </div>
        )}

        {error && !videoUrl && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/70">
            <div className="text-white text-center p-4 max-w-md">
              <div className="text-red-500 text-5xl mb-2">⚠️</div>
              <h3 className="text-xl font-bold mb-2">Camera Error</h3>
              <p className="mb-4">{error}</p>
              <button
                onClick={retryCamera}
                className="px-4 py-2 bg-primary rounded-md hover:bg-primary/80 transition-colors"
              >
                Retry Camera Access
              </button>
            </div>
          </div>
        )}

        {isRecording && !error && !videoUrl && (
          <div className="absolute top-4 right-4 flex items-center">
            <div className="w-3 h-3 rounded-full bg-red-500 animate-pulse mr-2"></div>
            <span className="text-white font-medium">Recording</span>
          </div>
        )}
      </div>
    </>
  )
}

