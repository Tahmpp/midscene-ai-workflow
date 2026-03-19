import requests
import pandas as pd
import io

def test_backend():
    print("Testing Backend APIs...")
    base_url = "http://localhost:8000/api"
    
    # 1. Test Upload
    print("1. Testing Upload...")
    df = pd.DataFrame({'ID': ['TC-001'], 'Title': ['Open Baidu'], 'Steps': ['Open https://www.baidu.com']})
    bio = io.BytesIO()
    df.to_excel(bio, index=False)
    bio.seek(0)
    
    files = {'file': ('test.xlsx', bio, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')}
    try:
        res = requests.post(f"{base_url}/upload/", files=files)
        print(f"Upload Status: {res.status_code}")
        if res.status_code != 201:
            print(f"Upload Failed: {res.text}")
            return
            
        cases = res.json()
        print(f"Uploaded {len(cases)} cases. IDs: {[c['case_id'] for c in cases]}")
        case_ids = [c['case_id'] for c in cases]
        
    except Exception as e:
        print(f"Upload Exception: {e}")
        return

    # 2. Test Generate
    print("2. Testing Generate...")
    try:
        res = requests.post(f"{base_url}/generate/", json={'case_ids': case_ids})
        print(f"Generate Status: {res.status_code}")
        if res.status_code != 200:
            print(f"Generate Failed: {res.text}")
            return
            
        scripts = res.json()
        print(f"Generated {len(scripts)} scripts.")
        print(f"Script Content Sample: {scripts[0]['yaml_content'][:50]}...")
        
    except Exception as e:
        print(f"Generate Exception: {e}")

if __name__ == "__main__":
    test_backend()
