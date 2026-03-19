
import asyncio
import os
import sys

# Add Midscene-Python-master to sys.path to ensure we can import it
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'Midscene-Python-master')))

try:
    from midscene.android import AndroidDevice
except ImportError:
    print("Failed to import midscene.android. Make sure the SDK is installed or in path.")
    sys.exit(1)

async def main():
    print("--- ADB Devices Debug ---")
    
    # Check raw adb output
    import subprocess
    try:
        result = subprocess.run(['adb', 'devices'], capture_output=True, text=True)
        print(f"RAW 'adb devices' output:\n{result.stdout}")
    except Exception as e:
        print(f"Failed to run adb devices: {e}")

    try:
        devices = await AndroidDevice.list_devices()

        print(f"Devices found via Midscene: {devices}")
        
        target_ip = "192.168.1.103"
        target_with_port = "192.168.1.103:5555"
        
        print(f"\nAttempting to connect to {target_ip}...")
        try:
            device = await AndroidDevice.create(target_ip)
            print(f"Successfully connected to {target_ip}")
            await device.disconnect()
        except Exception as e:
            print(f"Failed to connect to {target_ip}: {e}")
            
        print(f"\nAttempting to connect to {target_with_port}...")
        try:
            device = await AndroidDevice.create(target_with_port)
            print(f"Successfully connected to {target_with_port}")
            await device.disconnect()
        except Exception as e:
            print(f"Failed to connect to {target_with_port}: {e}")
            
    except Exception as e:
        print(f"General Error: {e}")

if __name__ == "__main__":
    asyncio.run(main())
